# Ledger backend boundaries

`ledger` owns the Django API and financial domain. Keep HTTP boundaries thin and
place reusable domain work in the narrowest service/query module that owns it.

## HTTP boundaries

| Module | Ownership |
| --- | --- |
| `api_urls.py` | React JSON API routing only. |
| `runtime_urls.py` / `runtime_views.py` | Non-React runtime endpoints such as health, attachments and exports. |
| `transaction_views.py` | Transaction, transfer and transaction-option HTTP handlers. |
| `account_views.py` | Accounts and reconciliation HTTP handlers. |
| `banking_views.py` | Bank connection, sync and review HTTP handlers. |
| `banking_callback_views.py` | Enable Banking callback and redirect boundary. |
| `category_views.py` | Category catalog and category-rule HTTP handlers. |
| `import_views.py` | CSV import/review HTTP handlers. |
| `planning_views.py` | Planning, budgets, savings goals and recurring HTTP handlers. |
| `subscription_review_views.py` | Evidence-bound accept/dismiss subscription review decisions. |
| `statistics_views.py` | Statistics report HTTP boundary. |
| `dashboard_views.py` | Dashboard bootstrap, preferences and snapshots. |
| `search_views.py` | Command-palette search. |
| `settings_views.py` | Automation settings. |
| `recovery_views.py` | Backup/recovery HTTP boundary. |

## Domain and query boundaries

| Module | Ownership |
| --- | --- |
| `services.py` | Shared financial calculations and read helpers used across multiple features. Do not put feature-specific mutations here. |
| `liquidity.py` | Account-level liquidity input queries and balance provenance for the Plan forecast. |
| `calculations/liquidity.py` | Pure Decimal daily cash-flow roll-forward; no ORM or HTTP dependencies. |
| `transaction_allocations.py` | Exact-sum allocation validation, ordered persistence, and legacy/explicit category projections for transactions. |
| `transaction_queries.py` | Transaction filtering and filtered-ledger summaries. |
| `transaction_services.py` | Transaction lifecycle mutations: transfers, archive and reopen. |
| `recurring_services.py` | Recurring occurrence materialization, matching and reconciliation mutations. |
| `category_services.py` | Category-rule matching/application mutations. |
| `import_services.py` | CSV parsing, category creation and row confirmation. |
| `dashboard_services.py` | Dashboard-only attention signals and review queue/read models. |
| `subscription_reviews.py` | Read-only review state/material-change rules separate from recurring schedules. |
| `savings_objectives.py` | Virtual goal assignments, aggregate ledger-balance limit, explicit over-allocation confirmation and stale-write/idempotency rules. |
| `banking_client.py` | Enable Banking provider HTTP/JWT client and configuration detection. |
| `banking_staging.py` | Provider payload normalization, account materialization and staged bank rows. |
| `banking_reconnect.py` | Safe provider-session renewal while preserving local account and banking history identity. |
| `banking.py` | Bank sync queue/state and synchronization orchestration. |
| `banking_categorization.py` | Rule/local-LLM category suggestions for pending bank rows. |
| `bank_review_services.py` | Bank-review confirmation mutation into ledger transactions. |
| `statistics.py` | Statistics/reporting domain logic. |
| `financial_read_models.py` | Persisted financial read-model maintenance and analysis. |
| `recovery.py` | Backup/recovery domain operations. |
| `management/commands/verify_restore_database.py` | Supported restore paths, SQLite WAL checkpoint and read-only financial schema/readiness checks. |
| `api_serializers.py` | JSON serialization helpers shared by HTTP boundaries. |

## Dependency rules

- Views may depend on serializers, queries, services and models. Domain modules must not import view modules.
- Keep provider transport in `banking_client.py`; provider payload mapping belongs in `banking_staging.py`; sync orchestration belongs in `banking.py`.
- Keep mutations out of `transaction_queries.py` and shared financial calculations out of feature-specific view modules.
- `services.py` is the shared financial calculation layer, not a default location for new backend logic.
- The retired server-rendered Django UI lives under `../obsoleto/django_ui/` and is not an active implementation source.
- Public API shapes, financial semantics, migrations, backup/recovery and performance budgets are contracts. Preserve them unless a task explicitly changes the contract.

For cross-module impact, prefer `python scripts/repo_graph.py query "..."` from the repository root, then verify the returned paths in source. Backend changes should normally finish with `python scripts/verify.py backend`; repository-contract changes also require `python scripts/verify.py repo-contracts`.
