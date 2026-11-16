import { sentenceCase, titleCaseName } from "@/lib/text-normalize";
import { toastError } from "@/lib/toast-message";
import { ConfirmDeleteDialog } from "@/components/admin/confirm-delete-dialog";
import { PageHeader } from "@/components/admin/page-header";
import { FieldError, RequiredMark } from "@/components/admin/required-mark";
import { FormActionBar } from "@/components/admin/form-action-bar";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryOptions } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  createQuestion,
  deleteQuestion,
  getQuestionnaire,
  listCategoryLinks,
  QQUESTION_TYPE_LABELS,
  replaceQuestionOptions,
  updateQuestion,
  updateQuestionnaire,
  type QQuestionType,
  type StoredQuestion,
  type StoredQuestionOption,
} from "@/lib/questionnaires.store";
import { categoriesQueryOptions } from "@/lib/query-options/categories";
import {
  adminLabel,
  adminInput,
  adminInputError,
  adminTextarea,
  adminSelect,
  adminSectionTitle,
  adminSectionSubtitle,
  adminCard,
  adminBtnPrimary,
  adminBtnSecondary,
} from "@/lib/admin-ui";

export const Route = createFileRoute("/_authenticated/admin/questionnaires/$questionnaireId")({
  head: () => ({
    meta: [
      { title: "Edit questionnaire · Body Inc Admin" },
      { name: "description", content: "Edit questionnaire — Admin area of the Body Inc portal." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: EditQuestionnairePage,
});

const detailKey = (id: string) => ["questionnaire", id] as const;
const detailQO = (id: string) =>
  queryOptions({
    queryKey: detailKey(id),
    queryFn: () => getQuestionnaire(id),
    staleTime: Number.POSITIVE_INFINITY,
  });

function EditQuestionnairePage() {
  const { questionnaireId } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const dataQ = useQuery(detailQO(questionnaireId));
  const catsQ = useQuery(categoriesQueryOptions());
  const linksQ = useQuery({
    queryKey: ["questionnaire-category-links"],
    queryFn: listCategoryLinks,
  });
  const takenBy = new Map(
    (linksQ.data ?? [])
      .filter((l) => l.questionnaire_id !== questionnaireId)
      .map((l) => [l.category_id, l.questionnaire_name]),
  );

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    const q = dataQ.data?.questionnaire;
    if (!q) return;
    setName(q.name);
    setDescription(q.description ?? "");
    setIsActive(q.is_active);
    setCategoryIds(q.category_ids);
  }, [dataQ.data?.questionnaire]);

  const saveMut = useMutation({
    mutationFn: () =>
      updateQuestionnaire(questionnaireId, {
        name: titleCaseName(name),
        description: sentenceCase(description) || null,
        is_active: isActive,
        category_ids: categoryIds,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: detailKey(questionnaireId) });
      qc.invalidateQueries({ queryKey: ["questionnaires"] });
      qc.invalidateQueries({ queryKey: ["questionnaire-category-links"] });
      toast.success("Changes saved.");
      navigate({ to: "/admin/questionnaires" });
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const addMut = useMutation({
    mutationFn: () =>
      createQuestion({
        questionnaire_id: questionnaireId,
        prompt: "New question",
        question_type: "yes_no",
        is_required: true,
        sort_order: dataQ.data?.questions.length ?? 0,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: detailKey(questionnaireId) });
      qc.invalidateQueries({ queryKey: ["questionnaires"] });
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  if (dataQ.isLoading) return <p className="text-sm text-[#3B4759]/60">Loading…</p>;
  if (!dataQ.data) return <p className="text-sm text-destructive">Not found</p>;

  return (
    <div className="admin-page-shell space-y-5 font-['DM_Sans',sans-serif] sm:space-y-6">
      <PageHeader
        backTo="/admin/questionnaires"
        backLabel="questionnaires"
        crumbs={[{ label: "Questionnaires", to: "/admin/questionnaires" }]}
        title={dataQ.data.questionnaire.name || "Edit questionnaire"}
      />
      <Card className={adminCard}>
        <CardHeader className="space-y-5 p-4 sm:p-6">
          <CardTitle className={adminSectionTitle}>Questionnaire details</CardTitle>
          <CardDescription className={adminSectionSubtitle}>
            Update name and linked medicines.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 p-4 pt-0 sm:p-6 sm:pt-0">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className={adminLabel}>
                Name
                <RequiredMark />
              </Label>
              <Input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (e.target.value.trim()) setNameError("");
                }}
                className={`${adminInput} ${nameError ? adminInputError : ""}`}
              />
              <FieldError message={nameError} />
            </div>
            <div className="flex items-end gap-3">
              <Switch checked={isActive} onCheckedChange={setIsActive} id="q-active" />
              <Label
                htmlFor="q-active"
                className="cursor-pointer select-none text-[16px] font-medium text-[#3B4759]"
              >
                Active
              </Label>
            </div>
          </div>
          <div className="space-y-2">
            <Label className={adminLabel}>Description</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={adminTextarea}
            />
          </div>
          <div className="space-y-2">
            <Label className={adminLabel}>Linked goals / categories</Label>
            <p className="text-[13px] font-normal text-[#3B4759]/60">
              Each category can be linked to only one questionnaire.
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {(catsQ.data ?? []).map((m) => {
                const checked = categoryIds.includes(m.id);
                const usedBy = takenBy.get(m.id);
                return (
                  <label
                    key={m.id}
                    className={`admin-check-row ${usedBy ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={!!usedBy}
                      className="h-5 w-5 rounded-[4px] border-[#D5DEDD] data-[state=checked]:border-[#6A9B9C] data-[state=checked]:bg-[#6A9B9C]"
                      onCheckedChange={(v) =>
                        setCategoryIds((prev) =>
                          v ? [...prev, m.id] : prev.filter((x) => x !== m.id),
                        )
                      }
                    />
                    <span className="min-w-0">
                      {m.name}
                      {usedBy && (
                        <span className="block text-[12px] font-normal text-[#3B4759]/50">
                          Used by {usedBy}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <h3 className={adminSectionTitle}>Questions</h3>
        <Button
          size="sm"
          onClick={() => addMut.mutate()}
          disabled={addMut.isPending}
          className={adminBtnPrimary}
        >
          <Plus className="mr-1.5 h-4 w-4" /> Add Question
        </Button>
      </div>

      <div className="space-y-4">
        {dataQ.data.questions.length === 0 && (
          <Card className={`${adminCard} border-dashed`}>
            <CardContent className="py-8 text-center text-[16px] text-[#3B4759]/60">
              No questions yet. Click &ldquo;Add Question&rdquo;.
            </CardContent>
          </Card>
        )}
        {dataQ.data.questions.map((q) => (
          <QuestionEditor key={q.id} question={q} questionnaireId={questionnaireId} />
        ))}
      </div>

      <FormActionBar
        submitting={saveMut.isPending}
        submitLabel="Save details"
        onSubmit={() => {
          if (!name.trim()) {
            setNameError("Please enter a name for this questionnaire.");
            return;
          }
          setNameError("");
          saveMut.mutate();
        }}
        onCancel={() => navigate({ to: "/admin/questionnaires" })}
        cancelLabel="Back"
      >
        Questionnaire name, description and linked categories.
      </FormActionBar>
    </div>
  );
}

function QuestionEditor({
  question,
  questionnaireId,
}: {
  question: StoredQuestion;
  questionnaireId: string;
}) {
  const qc = useQueryClient();
  const [prompt, setPrompt] = useState(question.prompt);
  const [description, setDescription] = useState(question.description ?? "");
  const [type, setType] = useState<QQuestionType>(question.question_type);
  const [required, setRequired] = useState(question.is_required);
  const [ynDisq, setYnDisq] = useState<"none" | "yes" | "no">(
    (question.disqualify_rules as any)?.if_yes
      ? "yes"
      : (question.disqualify_rules as any)?.if_no
        ? "no"
        : "none",
  );
  const [options, setOptions] = useState<Array<{ label: string; is_disqualifying: boolean }>>(
    question.options.map((o: StoredQuestionOption) => ({
      label: o.label,
      is_disqualifying: o.is_disqualifying,
    })),
  );
  const [promptError, setPromptError] = useState("");
  const [optionsError, setOptionsError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [optionToRemove, setOptionToRemove] = useState<number | null>(null);

  const saveMut = useMutation({
    mutationFn: async () => {
      await updateQuestion(question.id, {
        prompt: sentenceCase(prompt),
        description: sentenceCase(description) || null,
        question_type: type,
        is_required: required,
        sort_order: question.sort_order,
        disqualify_rules:
          type === "yes_no"
            ? ynDisq === "yes"
              ? { if_yes: true }
              : ynDisq === "no"
                ? { if_no: true }
                : {}
            : {},
      });
      if (type === "single_choice" || type === "multi_choice") {
        await replaceQuestionOptions(
          question.id,
          options
            .filter((o) => o.label.trim())
            .map((o) => ({ ...o, label: sentenceCase(o.label) })),
        );
      } else {
        await replaceQuestionOptions(question.id, []);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["questionnaire", questionnaireId] });
      toast.success("Question saved.");
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const deleteMut = useMutation({
    mutationFn: () => deleteQuestion(question.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["questionnaire", questionnaireId] });
      toast.success("Question deleted.");
      setConfirmDelete(false);
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  const showOptions = type === "single_choice" || type === "multi_choice";
  const showYesNo = type === "yes_no";

  return (
    <Card className={adminCard}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 p-4 pb-3 sm:p-6 sm:pb-3">
        <CardTitle className="text-[16px] font-medium text-[#3B4759]/60">Question</CardTitle>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-destructive"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-5 p-4 pt-0 sm:p-6 sm:pt-0">
        <div className="space-y-2">
          <Label className={adminLabel}>
            Prompt
            <RequiredMark />
          </Label>
          <Input
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              if (e.target.value.trim()) setPromptError("");
            }}
            className={`${adminInput} ${promptError ? adminInputError : ""}`}
          />
          <FieldError message={promptError} />
        </div>
        <div className="space-y-2">
          <Label className={adminLabel}>Helper text (optional)</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={adminInput}
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label className={adminLabel}>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as QQuestionType)}>
              <SelectTrigger className={adminSelect}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(QQUESTION_TYPE_LABELS).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-3">
            <Switch checked={required} onCheckedChange={setRequired} id={`req-${question.id}`} />
            <Label
              htmlFor={`req-${question.id}`}
              className="cursor-pointer select-none text-[16px] font-medium text-[#3B4759]"
            >
              Required
            </Label>
          </div>
          {showYesNo && (
            <div className="space-y-2">
              <Label className={adminLabel}>Disqualify when</Label>
              <Select value={ynDisq} onValueChange={(v) => setYnDisq(v as any)}>
                <SelectTrigger className={adminSelect}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Never</SelectItem>
                  <SelectItem value="yes">Answer is Yes</SelectItem>
                  <SelectItem value="no">Answer is No</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {showOptions && (
          <div className="space-y-2">
            <Label className={adminLabel}>
              Options (check the box to mark an option as disqualifying)
            </Label>
            <div className="space-y-2">
              {options.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={o.label}
                    placeholder={`Option ${i + 1}`}
                    className={adminInput}
                    onChange={(e) => {
                      const copy = [...options];
                      copy[i] = { ...copy[i], label: e.target.value };
                      setOptions(copy);
                    }}
                  />
                  <label className="admin-check-row shrink-0 border-0 p-0">
                    <Checkbox
                      checked={o.is_disqualifying}
                      className="h-5 w-5 rounded-[4px] border-[#D5DEDD] data-[state=checked]:border-[#6A9B9C] data-[state=checked]:bg-[#6A9B9C]"
                      onCheckedChange={(v) => {
                        const copy = [...options];
                        copy[i] = { ...copy[i], is_disqualifying: !!v };
                        setOptions(copy);
                      }}
                    />
                    Disqualifies
                  </label>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0 text-destructive"
                    onClick={() => {
                      if (!options[i]?.label.trim()) {
                        setOptions(options.filter((_, idx) => idx !== i));
                        return;
                      }
                      setOptionToRemove(i);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {optionsError ? <FieldError message={optionsError} /> : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setOptions([...options, { label: "", is_disqualifying: false }])}
                className={adminBtnSecondary}
              >
                <Plus className="mr-1.5 h-4 w-4" /> Add option
              </Button>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              if (!prompt.trim()) {
                setPromptError("Please enter the question text.");
                return;
              }
              if (
                (type === "single_choice" || type === "multi_choice") &&
                !options.some((option) => option.label.trim())
              ) {
                setOptionsError("Please add at least one answer option.");
                return;
              }
              setPromptError("");
              setOptionsError("");
              saveMut.mutate();
            }}
            disabled={saveMut.isPending}
            className={adminBtnPrimary}
          >
            {saveMut.isPending ? "Saving…" : "Save question"}
          </Button>
        </div>
      </CardContent>
      <ConfirmDeleteDialog
        open={confirmDelete}
        title="Delete this question?"
        description="This removes the question and its answer options. Patients will no longer see it."
        pending={deleteMut.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => deleteMut.mutate()}
      />
      <ConfirmDeleteDialog
        open={optionToRemove !== null}
        title="Remove this answer?"
        description="This answer will be removed when you save the question."
        confirmLabel="Remove"
        onCancel={() => setOptionToRemove(null)}
        onConfirm={() => {
          if (optionToRemove !== null) {
            setOptions(options.filter((_, idx) => idx !== optionToRemove));
          }
          setOptionToRemove(null);
        }}
      />
    </Card>
  );
}
