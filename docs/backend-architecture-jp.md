# Orbit — バックエンドシステム & エージェントアーキテクチャ

Orbit のバックエンドがどのように動作するのか、特に AI エージェントに焦点を当てた概要です。エージェントがどのように推論し、1件の顧客との会話（ミーティングの文字起こし）が、どのように全社的な実行計画へと変換されるのかを説明します。

---

# 1. バックエンドの役割

Orbit のバックエンドは、**顧客との会話（ミーティングの文字起こし）**を入力として受け取り、それを**会社全体の実行計画**へと変換します。

生成される成果物には以下が含まれます。

* PRD（Product Requirements Document）
* エンジニアリング計画
* デザイン計画
* QA（品質保証）戦略
* セールス向け資料
* 顧客フォローアップ

これらは単なる個別の成果物ではなく、**Execution Graph（実行グラフ）**として相互に関連付けられ、それぞれの成果物が

> **「なぜ存在するのか」**

を説明できるようになっています。

Orbit は議事録要約ツールではありません。

目的は**実行のオーケストレーション（Execution Coordination）**です。

つまり、

> Customer → Sales → Product → Engineering → Design → QA → Customer Success

という従来の手作業による引き継ぎを、一つの説明可能な自動パイプラインへ置き換えることです。

**技術スタック**

* FastAPI（非同期 API）
* LangGraph（エージェントオーケストレーション）
* PydanticAI（型安全な LLM ラッパー）
* SQLAlchemy 2（Async）
* PostgreSQL / SQLite
* Redis（任意）
* Docker

---

# 2. システムの4つのレイヤー

```
┌────────────────────────────────────────────────────────────┐
│ HTTP Layer                                                 │
│ FastAPI + 9つのREST API                                    │
│ (meetings, graph, projects, tasks...)                      │
├────────────────────────────────────────────────────────────┤
│ Agent Layer ★                                              │
│ LangGraph上で動く8つのPydanticAIエージェント               │
│ + モデルサービス                                           │
├────────────────────────────────────────────────────────────┤
│ Persistence Layer                                          │
│ エージェント出力をProject・Graph・Taskへ保存               │
├────────────────────────────────────────────────────────────┤
│ Data / Infrastructure                                      │
│ Async SQLAlchemy・Postgres/SQLite・Redis・Clerk・Settings  │
└────────────────────────────────────────────────────────────┘
```

システム全体は、**Agent Layer（★）**へ文字起こしデータを渡し、その生成結果を永続化するために存在しています。

---

# 3. エンドツーエンドの処理フロー

ユーザーが

```
POST /meetings/transcript
```

を呼び出すと、以下の流れで処理が進みます。

```
POST /meetings/transcript
        │
        ▼
Meeting レコード作成
(status = "analyzing")
        │
        ▼
_execute_pipeline(meeting)
        │
        ├── run_pipeline()
        │
        │   8つのAIエージェントが実行され
        │   state が生成される
        │
        │   {
        │      signals,
        │      prd,
        │      teams,
        │      engineering,
        │      design,
        │      qa,
        │      sales,
        │      customer_update
        │   }
        │
        ├── signals_to_analysis()
        │
        │   UI用データへ変換
        │
        ├── feature request /
        │    pain point が存在する場合
        │
        │      persist_execution()
        │
        │    なければ
        │
        │      delete_execution()
        │
        └── commit
```

この `_execute_pipeline()` は

* `POST /meetings/transcript`
* `POST /meetings/{id}/analyze`

の両方から利用されます。

再解析（Re-run）は**冪等（Idempotent）**であり、保存済みの Graph・Project・Task を削除してから新しい結果を書き込みます。

---

# 4. エージェントシステム（Orbit の中核）

## 4.1 エージェントとは何か

各エージェントは3つの要素で構成されています。

### ① システムプロンプト

役割と専門性を定義します。

例

> "You are Orbit's Engineering Planner..."

---

### ② 型付き出力スキーマ

Pydantic モデルで出力形式を厳密に定義します。

`NativeOutput` による**Constrained Decoding**を利用することで、

* 必ずJSONになる
* スキーマに一致する
* バリデーション失敗時は最大3回リトライ

が保証されます。

---

### ③ モデル

LLM はハードコードされません。

すべて

```python
build_model()
```

経由で取得されます。

エージェント生成は実質1行です。

```python
Agent(
    build_model(model),
    output_type=NativeOutput(output_type),
    system_prompt=system_prompt,
    retries=3
)
```

出力は camelCase の型付き JSON のため、そのままフロントエンドへ渡せます。

---

## 4.2 モデルサービス

エージェントは

* OpenAI
* Claude
* Gemini

などを直接指定しません。

環境変数

```
DEFAULT_MODEL
```

だけを見ます。

例

```
DEFAULT_MODEL="google-gla:gemini-flash-lite-latest"
```

```
provider:model
```

という形式になっています。

```
DEFAULT_MODEL
      │
      ▼
build_model()
      │
      ▼
Registry
      │
      ▼
PydanticAI Model
```

対応プロバイダ

* google-gla
* google
* ollama
* anthropic
* openai

用途別の例

| 用途    | DEFAULT_MODEL                       |
| ----- | ----------------------------------- |
| 開発    | google-gla:gemini-flash-lite-latest |
| オフライン | ollama:llama3.1                     |
| 本番    | anthropic:claude-opus-4-8           |

LLM の切り替えは**環境変数の変更だけ**で済みます。

---

## 4.3 8つのエージェント

| # | エージェント               | 入力                | 出力                  |
| - | -------------------- | ----------------- | ------------------- |
| 1 | Meeting Intelligence | 文字起こし             | シグナル（要約・感情・課題・要望など） |
| 2 | Product Manager      | Signals           | PRD                 |
| 3 | Execution Router ★   | Signals + PRD     | どのチームが必要か           |
| 4 | Engineering Planner  | PRD               | 技術設計・工数・リスク         |
| 5 | Design Planner       | PRD               | 画面・UX・ユーザーフロー       |
| 6 | QA Planner           | PRD + Engineering | テスト戦略               |
| 7 | Sales Planner        | PRD               | 営業資料・ポジショニング        |
| 8 | Customer Success     | Signals + Account | 顧客フォローアップメール        |

※ 第9エージェントの Leadership Advisor は定義済みですが、まだ接続されていません。

---

## 4.4 LangGraph によるパイプライン

エージェントは LangGraph の **StateGraph** として接続されています。

各ノードは

* state を読む
* state を更新する

だけを行います。

依存関係のないノードは並列実行されます。

```
Transcript
      │
      ▼
Meeting Intelligence
      │
      ▼
Product Manager
      │
      ▼
Execution Router
      │
   ┌──┴──────┐
   ▼         ▼
Engineering Design
   │         │
   ▼         ▼
 Sales      QA
      \     /
       ▼   ▼
 Customer Success
       │
       ▼
 Final State
```

---

## 4.5 Execution Router（Orbit 最大の特徴）

Execution Router は

> 「どのチームが本当に必要か」

を判断します。

すべての案件で

* デザイン
* QA
* セールス

が必要とは限りません。

例えば

**「API の 504 エラー」**

なら

| チーム              | 判断   | 理由          |
| ---------------- | ---- | ----------- |
| Engineering      | 実行   | バックエンド改善が必要 |
| QA               | 実行   | 負荷試験が必要     |
| Customer Success | 実行   | 顧客への進捗共有    |
| Design           | スキップ | UI変更なし      |
| Sales            | スキップ | 営業対応不要      |

スキップされたチームは LLM を呼びません。

```python
if not relevant:
    state["design"] = {
        "skipped": True,
        "reason": reason
    }
    return state
```

つまり

* 無駄な生成をしない
* ダミー成果物を作らない
* Graph 上にも "Skipped" と理由が残る

これが Orbit をテンプレート生成ツールではなく、「実際に判断する AI オペレーター」にしています。

---

## 4.6 Graceful Degradation

各エージェントは

```python
try:
    return await agent.run(...)
except:
    return fallback(...)
```

という構造です。

そのため

* APIキーがない
* LLM が落ちた
* JSON生成失敗
* Rate Limit
* Timeout

でも処理全体は止まりません。

各エージェントには

**決定論的フォールバック**

（正規表現・ヒューリスティック）があり、

最低限の成果物を生成します。

さらに LangGraph 自体が利用できない場合でも、同じノードを順番に実行するフォールバック経路があります。

---

# 5. エージェント出力から Execution Graph へ

最終的な `state` は Persistence Layer に渡され、

以下のデータへ変換されます。

### Project

全体を表すレコード

* 名前
* 健全性
* 売上インパクト
* 期限

などを保持します。

---

### Graph Node

例

```
Meeting
    │
Feature Request
    │
PRD
 ├── Engineering
 ├── Design
 ├── Sales
 └── QA
      │
Customer Follow-up
```

各ノードには

```
meta.reason
```

として

> なぜ存在するのか

が保存されます。

スキップされたノードは

```
status = "skipped"
```

となり、理由のみ保持されます。

---

### Graph Edge

成果物同士の因果関係を保持します。

例

> この PRD は、この Feature Request があったため作成された

という情報を表現します。

---

### Tasks

Engineering Planner の出力から実際のタスクを生成し、

Meeting・Graph Node と紐付けます。

---

Signal Guard により、

Feature Request や Pain Point が存在しない会話では

Execution Graph 自体が生成されません。

---

# 6. データモデル

主要テーブルは10個です。

```
Meeting
   │
   ▼
Project
 ├── GraphNode
 ├── GraphEdge
 ├── Task
 ├── PRD(JSON)
 ├── Engineering(JSON)
 ├── Design(JSON)
 ├── QA(JSON)
 └── Sales(JSON)

Meeting
 ├── TimelineEvent
 └── ActivityEvent

Member
Agent
Integration
```

PRD や各種計画は JSON カラムとして保存されます。

---

# 7. インフラ

* Async SQLAlchemy
* PostgreSQL / SQLite
* Redis（任意）
* Clerk JWT 認証
* `.env` ベースの設定管理

Redis や認証が存在しない場合でも、

開発環境では自動的にデモモードへ切り替わるため、システム全体は動作します。

---

# 8. Orbit を支える2つの設計思想

## ① Provider Agnostic + Graceful Degradation

* LLM は環境変数だけで切り替え可能
* API がなくても動作
* 一部の失敗でも全体は停止しない

---

## ② Graph is the Product

Orbit の成果物は要約ではありません。

AI エージェントが

* PRD
* Engineering Plan
* Design Plan
* QA Strategy
* Sales Enablement
* Customer Follow-up

を生成し、

さらに

* それらの関係性
* どのチームが本当に必要か
* なぜその成果物が存在するのか

まで含めた **Execution Graph** を構築します。

---

## 一文でまとめると

**顧客との会話（文字起こし）が FastAPI を通じて入力され、LangGraph 上で 8 つの型安全な PydanticAI エージェント（すべてフォールバック付き）が実行されます。その後、Execution Router が本当に必要なチームを判断し、最終的に Persistence Layer が、各成果物とその存在理由を保持した「ミーティング単位の Execution Graph」として保存します。**
