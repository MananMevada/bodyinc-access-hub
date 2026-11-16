import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { assertAdmin } from "@/lib/admin-guard";
import { backupThen, fetchMatching, newBackupId } from "@/lib/data-backup.server";

const inputSchema = z.object({
  kind: z.enum(["questionnaire", "question", "category", "relationship"]),
  id: z.string().uuid(),
});

export const deleteStoredRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => inputSchema.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const wipeId = newBackupId();

    if (data.kind === "questionnaire") {
      const questionnaires = await fetchMatching(db, "questionnaires", "id", [data.id]);
      const questions = await fetchMatching(db, "questionnaire_questions", "questionnaire_id", [data.id]);
      const questionIds = questions.map((row: { id: string }) => row.id);
      const [options, categories, medicines] = await Promise.all([
        fetchMatching(db, "questionnaire_question_options", "question_id", questionIds),
        fetchMatching(db, "questionnaire_categories", "questionnaire_id", [data.id]),
        fetchMatching(db, "questionnaire_medicines", "questionnaire_id", [data.id]),
      ]);
      await backupThen(
        db,
        {
          wipeId,
          group: "questionnaire",
          wipedBy: context.userId,
          label: questionnaires[0]?.name?.trim() || "Questionnaire",
          batches: [
            { table: "questionnaires", rows: questionnaires },
            { table: "questionnaire_questions", rows: questions },
            { table: "questionnaire_question_options", rows: options },
            { table: "questionnaire_categories", rows: categories },
            { table: "questionnaire_medicines", rows: medicines },
          ],
        },
        async () => {
          const { error } = await db.from("questionnaires").delete().eq("id", data.id);
          if (error) throw new Error(error.message);
        },
      );
      return { ok: true as const };
    }

    if (data.kind === "question") {
      const questions = await fetchMatching(db, "questionnaire_questions", "id", [data.id]);
      const options = await fetchMatching(db, "questionnaire_question_options", "question_id", [data.id]);
      await backupThen(
        db,
        {
          wipeId,
          group: "questionnaire",
          wipedBy: context.userId,
          label: questions[0]?.prompt?.trim() || "Question",
          batches: [
            { table: "questionnaire_questions", rows: questions },
            { table: "questionnaire_question_options", rows: options },
          ],
        },
        async () => {
          const { error } = await db.from("questionnaire_questions").delete().eq("id", data.id);
          if (error) throw new Error(error.message);
        },
      );
      return { ok: true as const };
    }

    if (data.kind === "category") {
      const categories = await fetchMatching(db, "medication_categories", "id", [data.id]);
      const [links, questionnaireLinks] = await Promise.all([
        fetchMatching(db, "medication_category_medicines", "category_id", [data.id]),
        fetchMatching(db, "questionnaire_categories", "category_id", [data.id]),
      ]);
      await backupThen(
        db,
        {
          wipeId,
          group: "category",
          wipedBy: context.userId,
          label: categories[0]?.name?.trim() || "Category",
          batches: [
            { table: "medication_categories", rows: categories },
            { table: "medication_category_medicines", rows: links },
            { table: "questionnaire_categories", rows: questionnaireLinks },
          ],
        },
        async () => {
          const { error } = await db.from("medication_categories").delete().eq("id", data.id);
          if (error) throw new Error(error.message);
        },
      );
      return { ok: true as const };
    }

    const rules = await fetchMatching(db, "medication_relationships", "id", [data.id]);
    await backupThen(
      db,
      {
        wipeId,
        group: "rule",
        wipedBy: context.userId,
        label: "Medicine rule",
        batches: [{ table: "medication_relationships", rows: rules }],
      },
      async () => {
        const { error } = await db.from("medication_relationships").delete().eq("id", data.id);
        if (error) throw new Error(error.message);
      },
    );
    return { ok: true as const };
  });
