import { sentenceCase, titleCaseName } from "@/lib/text-normalize";
import { toastError } from "@/lib/toast-message";
import { PageHeader } from "@/components/admin/page-header";
import { FormActionBar } from "@/components/admin/form-action-bar";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RequiredMark } from "@/components/admin/required-mark";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createQuestionnaire, listCategoryLinks } from "@/lib/questionnaires.store";
import { categoriesQueryOptions } from "@/lib/query-options/categories";
import {
  adminLabel,
  adminInput,
  adminTextarea,
  adminPageTitle,
  adminPageSubtitle,
  adminSectionTitle,
  adminSectionSubtitle,
  adminCard,
  adminBtnPrimary,
  adminBtnSecondary,
} from "@/lib/admin-ui";

export const Route = createFileRoute("/_authenticated/admin/questionnaires/new")({
  head: () => ({
    meta: [
      { title: "New questionnaire · Body Inc Admin" },
      { name: "description", content: "New questionnaire — Admin area of the Body Inc portal." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NewQuestionnairePage,
});

function NewQuestionnairePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const catsQ = useQuery(categoriesQueryOptions());
  const linksQ = useQuery({
    queryKey: ["questionnaire-category-links"],
    queryFn: listCategoryLinks,
  });
  const takenBy = new Map((linksQ.data ?? []).map((l) => [l.category_id, l.questionnaire_name]));
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);

  const mut = useMutation({
    mutationFn: () =>
      createQuestionnaire({
        name: titleCaseName(name),
        description: sentenceCase(description) || null,
        is_active: isActive,
        category_ids: categoryIds,
      }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["questionnaires"] });
      qc.invalidateQueries({ queryKey: ["questionnaire-category-links"] });
      toast.success("Question set created.");
      navigate({
        to: "/admin/questionnaires/$questionnaireId",
        params: { questionnaireId: r.id },
      });
    },
    onError: (e: Error) => toast.error(toastError(e)),
  });

  return (
    <div className="admin-page-shell space-y-5 font-['DM_Sans',sans-serif] sm:space-y-6">
      <PageHeader
        backTo="/admin/questionnaires"
        backLabel="questionnaires"
        crumbs={[{ label: "Questionnaires", to: "/admin/questionnaires" }]}
        title="New questionnaire"
        subtitle="Add screening configurations and structure questions."
      />

      <Card className={adminCard}>
        <CardHeader className="space-y-2 p-4 sm:p-6">
          <CardTitle className={adminSectionTitle}>Questionnaire details</CardTitle>
          <CardDescription className={adminSectionSubtitle}>
            Add details below. You will be able to add screening questions after creating.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 p-4 pt-0 sm:p-6 sm:pt-0">
          <div className="space-y-2">
            <Label className={adminLabel}>
              Name
              <RequiredMark />
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. GLP-1 Eligibility"
              className={adminInput}
            />
          </div>

          <div className="space-y-2">
            <Label className={adminLabel}>Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Context or instructions for this question set"
              className={adminTextarea}
            />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Switch checked={isActive} onCheckedChange={setIsActive} id="q-active" />
            <Label
              htmlFor="q-active"
              className="cursor-pointer select-none text-[16px] font-medium text-[#3B4759]"
            >
              Active
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card className={adminCard}>
        <CardHeader className="space-y-2 p-4 sm:p-6">
          <CardTitle className={adminSectionTitle}>Linked goals / categories</CardTitle>
          <CardDescription className={adminSectionSubtitle}>
            Patients selecting these goals/categories will see this custom screening sequence during
            checkout. Each category can be linked to only one questionnaire.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
          {catsQ.isLoading && (
            <p className="py-2 text-[14px] font-normal text-[#3B4759]/60">Loading categories…</p>
          )}
          {!catsQ.isLoading && (catsQ.data ?? []).length === 0 && (
            <p className="py-2 text-[14px] font-normal text-[#3B4759]/60">
              No categories found to link.
            </p>
          )}
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
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
                    onCheckedChange={(v) => {
                      setCategoryIds((prev) =>
                        v ? [...prev, m.id] : prev.filter((x) => x !== m.id),
                      );
                    }}
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
        </CardContent>
      </Card>

      <FormActionBar
        submitting={mut.isPending}
        disabled={!name.trim()}
        submitLabel="Create questionnaire"
        onSubmit={() => mut.mutate()}
        onCancel={() => navigate({ to: "/admin/questionnaires" })}
      />
    </div>
  );
}
