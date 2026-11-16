import { supabase } from "@/integrations/supabase/client";

export type QQuestionType = "text" | "number" | "yes_no" | "single_choice" | "multi_choice";

export type StoredQuestionOption = {
  id: string;
  question_id: string;
  label: string;
  value: string | null;
  sort_order: number;
  is_disqualifying: boolean;
};

export type StoredQuestion = {
  id: string;
  questionnaire_id: string;
  prompt: string;
  description: string | null;
  question_type: QQuestionType;
  is_required: boolean;
  sort_order: number;
  disqualify_rules: Record<string, unknown>;
  options: StoredQuestionOption[];
};

export type StoredQuestionnaire = {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  category_ids: string[];
  question_count: number;
  created_at: string;
  updated_at: string;
};

export async function listQuestionnaires(): Promise<StoredQuestionnaire[]> {
  const { data, error } = await supabase
    .from("questionnaires")
    .select("*, questionnaire_categories(category_id), questionnaire_questions(id)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    is_active: r.is_active,
    category_ids: (r.questionnaire_categories ?? []).map((m: any) => String(m.category_id)),
    question_count: (r.questionnaire_questions ?? []).length,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));
}

export async function getQuestionnaire(id: string): Promise<{
  questionnaire: StoredQuestionnaire;
  questions: StoredQuestion[];
} | null> {
  const { data, error } = await supabase
    .from("questionnaires")
    .select(
      "*, questionnaire_categories(category_id), questionnaire_questions(*, questionnaire_question_options(*))",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const r: any = data;
  const questionnaire: StoredQuestionnaire = {
    id: r.id,
    name: r.name,
    description: r.description,
    is_active: r.is_active,
    category_ids: (r.questionnaire_categories ?? []).map((m: any) => String(m.category_id)),
    question_count: (r.questionnaire_questions ?? []).length,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
  const questions: StoredQuestion[] = (r.questionnaire_questions ?? [])
    .map((q: any) => ({
      id: q.id,
      questionnaire_id: q.questionnaire_id,
      prompt: q.prompt,
      description: q.description,
      question_type: q.question_type,
      is_required: q.is_required,
      sort_order: q.sort_order,
      disqualify_rules: q.disqualify_rules ?? {},
      options: (q.questionnaire_question_options ?? [])
        .map((o: any) => ({
          id: o.id,
          question_id: o.question_id,
          label: o.label,
          value: o.value,
          sort_order: o.sort_order,
          is_disqualifying: !!o.is_disqualifying,
        }))
        .sort((a: StoredQuestionOption, b: StoredQuestionOption) => a.sort_order - b.sort_order),
    }))
    .sort((a: StoredQuestion, b: StoredQuestion) => a.sort_order - b.sort_order);
  return { questionnaire, questions };
}

async function syncQuestionnaireCategories(questionnaireId: string, categoryIds: string[]) {
  await supabase.from("questionnaire_categories").delete().eq("questionnaire_id", questionnaireId);
  if (categoryIds.length > 0) {
    const rows = categoryIds.map((cid) => ({
      questionnaire_id: questionnaireId,
      category_id: cid,
    }));
    const { error } = await supabase.from("questionnaire_categories").insert(rows as any);
    if (error) {
      if ((error as any).code === "23505") {
        throw new Error(
          "One of the selected categories is already linked to another questionnaire. A category can only have one questionnaire.",
        );
      }
      throw new Error(error.message);
    }
  }
}

export type QuestionnaireCategoryLink = {
  category_id: string;
  questionnaire_id: string;
  questionnaire_name: string;
};

export async function listCategoryLinks(): Promise<QuestionnaireCategoryLink[]> {
  const { data, error } = await supabase
    .from("questionnaire_categories")
    .select("category_id, questionnaire_id, questionnaires(name)");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    category_id: String(r.category_id),
    questionnaire_id: String(r.questionnaire_id),
    questionnaire_name: r.questionnaires?.name ?? "another questionnaire",
  }));
}

export async function createQuestionnaire(input: {
  name: string;
  description?: string | null;
  is_active: boolean;
  category_ids: string[];
}): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("questionnaires")
    .insert({
      name: input.name,
      description: input.description ?? null,
      is_active: input.is_active,
    } as any)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  await syncQuestionnaireCategories(data.id, input.category_ids);
  return { id: data.id };
}

export async function updateQuestionnaire(
  id: string,
  input: { name: string; description?: string | null; is_active: boolean; category_ids: string[] },
): Promise<{ id: string }> {
  const { error } = await supabase
    .from("questionnaires")
    .update({
      name: input.name,
      description: input.description ?? null,
      is_active: input.is_active,
    } as any)
    .eq("id", id);
  if (error) throw new Error(error.message);
  await syncQuestionnaireCategories(id, input.category_ids);
  return { id };
}

export async function deleteQuestionnaire(id: string): Promise<{ ok: true }> {
  const { deleteStoredRecord } = await import("@/lib/catalog-deletes.functions");
  await deleteStoredRecord({ data: { kind: "questionnaire", id } });
  return { ok: true };
}

export async function createQuestion(input: {
  questionnaire_id: string;
  prompt: string;
  description?: string | null;
  question_type: QQuestionType;
  is_required: boolean;
  sort_order: number;
  disqualify_rules?: Record<string, unknown>;
}): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("questionnaire_questions")
    .insert({
      questionnaire_id: input.questionnaire_id,
      prompt: input.prompt,
      description: input.description ?? null,
      question_type: input.question_type,
      is_required: input.is_required,
      sort_order: input.sort_order,
      disqualify_rules: input.disqualify_rules ?? {},
    } as any)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id };
}

export async function updateQuestion(
  id: string,
  input: Partial<{
    prompt: string;
    description: string | null;
    question_type: QQuestionType;
    is_required: boolean;
    sort_order: number;
    disqualify_rules: Record<string, unknown>;
  }>,
): Promise<{ ok: true }> {
  const { error } = await supabase
    .from("questionnaire_questions")
    .update(input as any)
    .eq("id", id);
  if (error) throw new Error(error.message);
  return { ok: true };
}

export async function deleteQuestion(id: string): Promise<{ ok: true }> {
  const { deleteStoredRecord } = await import("@/lib/catalog-deletes.functions");
  await deleteStoredRecord({ data: { kind: "question", id } });
  return { ok: true };
}

export async function replaceQuestionOptions(
  questionId: string,
  options: { label: string; value?: string | null; is_disqualifying: boolean }[],
): Promise<{ ok: true }> {
  await supabase.from("questionnaire_question_options").delete().eq("question_id", questionId);
  if (options.length > 0) {
    const rows = options.map((o, i) => ({
      question_id: questionId,
      label: o.label,
      value: o.value ?? null,
      sort_order: i,
      is_disqualifying: !!o.is_disqualifying,
    }));
    const { error } = await supabase.from("questionnaire_question_options").insert(rows as any);
    if (error) throw new Error(error.message);
  }
  return { ok: true };
}

export const QQUESTION_TYPE_LABELS: Record<QQuestionType, string> = {
  text: "Text",
  number: "Number",
  yes_no: "Yes / No",
  single_choice: "Single choice",
  multi_choice: "Multiple choice",
};
