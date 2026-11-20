import {describe, expect, it, vi} from "vitest";
import type {Category} from "../shared/model/categories";
import type {PreparedReview} from "../features/review/adapters/reviewAdapterTypes";
import {buildReviewRuleGroups} from "../features/review/reviewRuleModel";
import {reviewMatchesFilter} from "../features/review/reviewQueueFilter";

const category = (id: number, name: string): Category => ({
  id,
  name,
  display_name: name,
  kind: "expense",
  color: "#3478F6",
  icon: "tag",
  active: true,
  parent_id: null,
  exclude_from_analytics: false,
  sort_order: id,
  is_favorite: false,
});

const food = category(1, "Comida");
const home = category(2, "Hogar");

const rule = (id: number, result = food, priority = 10, description = "Super") => ({
  id,
  description,
  kind: "expense" as const,
  category: result,
  priority,
  match_mode: "contains" as const,
  account_id: null,
  amount_min: null,
  amount_max: null,
});

function prepared(id: number, overrides: Partial<PreparedReview> = {}): PreparedReview {
  return {
    source: "bank",
    sourceId: id,
    contextAccountId: 12,
    contextBatchId: null,
    categoryRuleMatches: [rule(7)],
    draftIsDirty: false,
    item: {
      id: `bank:${id}`,
      description: `Super ${id}`,
      date: "2026-10-20",
      signedAmount: -12,
      kind: "expense",
      account: {name: "Cuenta diaria", color: "#3478F6"},
      category: {name: "Comida", color: "#3478F6"},
      isRefund: false,
      attachmentCount: 0,
      status: "ready",
      changes: [],
      issues: [],
    },
    draft: {
      kind: "expense",
      amount: "12",
      account: "12",
      source_account: "",
      target_account: "",
      date: "2026-10-20",
      description: `Super ${id}`,
      category: "1",
      refund_for: "",
      notes: "",
      tag_names: "",
      remember_category: false,
      new_category: "",
      new_subcategory: "",
    },
    history: "new",
    preparation: "prepared",
    decision: "pending",
    changes: [],
    issues: [],
    blockingIssues: [],
    attentionIssues: [],
    capabilities: {
      canEditDraft: true,
      editableFields: ["category"],
      canPersistStandaloneEdit: false,
      select: true,
      confirm: true,
      force: false,
      category: false,
      skip: true,
      transfer: false,
      canChooseRefund: false,
      canRememberCategory: true,
    },
    editorInput: {} as PreparedReview["editorInput"],
    actions: {},
    displayStatus: "ready",
    ...overrides,
  };
}

describe("Review rule groups", () => {
  it("groups only the same rule, source, account and kind in stable priority order", () => {
    const rows = [prepared(2), prepared(1), prepared(3, {contextAccountId: 99})];
    rows[0] = {...rows[0], categoryRuleMatches: [rule(7, food, 10), rule(9, food, 20)]};
    const result = buildReviewRuleGroups(rows);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({id: "bank:bank:12:expense:7:1", rule: {id: 7}, accountId: 12});
    expect(result.groups[0].rows.map((row) => row.sourceId)).toEqual([1, 2]);
    expect(result.conflicts).toEqual([]);
  });

  it("preserves the backend's canonical rule precedence across browser locales", () => {
    const backendLeader = rule(31, food, 10, "Z");
    const localeSortedFirst = rule(32, food, 10, "a");
    const matches = [backendLeader, localeSortedFirst];
    const localeCompare = vi.spyOn(String.prototype, "localeCompare");
    try {
      const result = buildReviewRuleGroups([
        prepared(1, {categoryRuleMatches: matches}),
        prepared(2, {categoryRuleMatches: matches}),
      ]);

      expect(result.groups[0].rule.id).toBe(backendLeader.id);
      expect(localeCompare.mock.calls).not.toContainEqual(["a"]);
      expect(localeCompare.mock.calls).not.toContainEqual(["Z"]);
    } finally {
      localeCompare.mockRestore();
    }
  });

  it("keeps overlapping categories and manual overrides outside the group", () => {
    const conflicted = prepared(3, {categoryRuleMatches: [rule(8, home, 5), rule(7, food, 10)]});
    const overridden = prepared(4, {draft: {...prepared(4).draft, category: "2"}});
    const result = buildReviewRuleGroups([prepared(1), prepared(2), conflicted, overridden]);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].rows.map((row) => row.sourceId)).toEqual([1, 2]);
    expect(result.conflicts.map(({prepared: item, reason}) => [item.sourceId, reason])).toEqual([
      [3, "Varias reglas coinciden con categorías distintas."],
      [4, "La categoría del borrador difiere de la regla; se conserva para revisión individual."],
    ]);
  });

  it("keeps CSV drafts with new category details outside the group", () => {
    const dirtyCsvDraft = prepared(3, {
      source: "csv",
      contextBatchId: 4,
      draft: {...prepared(3).draft, new_subcategory: "Hogar"},
      draftIsDirty: true,
    });
    const result = buildReviewRuleGroups([prepared(1), prepared(2), dirtyCsvDraft]);

    expect(result.groups[0].rows.map((row) => row.sourceId)).toEqual([1, 2]);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({prepared: dirtyCsvDraft, reason: "El borrador tiene cambios sin aplicar; se conserva para revisión individual."});
  });

  it("leaves duplicates, transfers, refunds, and incomplete drafts individual", () => {
    const duplicate = prepared(3, {attentionIssues: [{code: "possible-duplicate", message: "Posible duplicado."}]});
    const refund = prepared(4, {capabilities: {...prepared(4).capabilities, canChooseRefund: true}});
    const invalid = prepared(5, {blockingIssues: [{code: "date-missing", message: "Falta la fecha."}]});
    const result = buildReviewRuleGroups([prepared(1), prepared(2), duplicate, refund, invalid]);

    expect(result.groups[0].rows.map((row) => row.sourceId)).toEqual([1, 2]);
    expect(result.conflicts.map(({prepared: item}) => item.sourceId)).toEqual([3, 4, 5]);
  });

  it("does not emit singleton groups or mutate prepared drafts", () => {
    const row = prepared(1);
    const snapshot = structuredClone(row);
    expect(buildReviewRuleGroups([row])).toEqual({groups: [], conflicts: []});
    expect(row).toEqual(snapshot);
  });

  it("builds the prepared-group preview from only rows visible under the Prepared filter", () => {
    const attention = prepared(3, {
      preparation: "needs_attention",
      attentionIssues: [{code: "possible-duplicate", message: "Posible duplicado."}],
    });
    const visible = [prepared(1), prepared(2), attention].filter((row) => reviewMatchesFilter(row, "prepared"));
    const result = buildReviewRuleGroups(visible);

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].rows.map((row) => row.sourceId)).toEqual([1, 2]);
    expect(result.conflicts).toEqual([]);
  });
});
