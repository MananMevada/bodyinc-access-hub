import { supabase } from "@/integrations/supabase/client";

export type RelationshipType = "incompatible" | "restricted";

export type StoredRelationship = {
  id: string;
  medicine_a_id: string;
  medicine_b_id: string;
  relationship: RelationshipType;
  reason: string | null;
  medicine_a_name?: string;
  medicine_b_name?: string;
  created_at: string;
};

export async function listRelationships(): Promise<StoredRelationship[]> {
  const { data, error } = await supabase
    .from("medication_relationships")
    .select(
      "*, medicine_a:medicines!medication_relationships_medicine_a_id_fkey(name), medicine_b:medicines!medication_relationships_medicine_b_id_fkey(name)",
    )
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: any) => ({
    id: r.id,
    medicine_a_id: r.medicine_a_id,
    medicine_b_id: r.medicine_b_id,
    relationship: r.relationship,
    reason: r.reason,
    medicine_a_name: r.medicine_a?.name,
    medicine_b_name: r.medicine_b?.name,
    created_at: r.created_at,
  }));
}

export async function createRelationship(input: {
  medicine_a_id: string;
  medicine_b_id: string;
  relationship: RelationshipType;
  reason?: string | null;
}): Promise<{ id: string }> {
  if (input.medicine_a_id === input.medicine_b_id) {
    throw new Error("Pick two different medicines");
  }
  const { data, error } = await supabase
    .from("medication_relationships")
    .insert({
      medicine_a_id: input.medicine_a_id,
      medicine_b_id: input.medicine_b_id,
      relationship: input.relationship,
      reason: input.reason ?? null,
    } as any)
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { id: data.id };
}

export async function deleteRelationship(id: string): Promise<{ ok: true }> {
  const { deleteStoredRecord } = await import("@/lib/catalog-deletes.functions");
  await deleteStoredRecord({ data: { kind: "relationship", id } });
  return { ok: true };
}
