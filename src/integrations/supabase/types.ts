export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      additional_payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          from_package_id: string | null
          id: string
          paid_at: string | null
          reason: string | null
          request_id: string
          status: string
          stripe_checkout_session_id: string | null
          stripe_invoice_id: string | null
          stripe_payment_intent_id: string | null
          to_package_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          from_package_id?: string | null
          id?: string
          paid_at?: string | null
          reason?: string | null
          request_id: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          to_package_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          from_package_id?: string | null
          id?: string
          paid_at?: string | null
          reason?: string | null
          request_id?: string
          status?: string
          stripe_checkout_session_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          to_package_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "additional_payments_from_package_id_fkey"
            columns: ["from_package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "additional_payments_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "medication_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "additional_payments_to_package_id_fkey"
            columns: ["to_package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "additional_payments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_activity_log: {
        Row: {
          action: string
          admin_user_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
        }
        Insert: {
          action: string
          admin_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
        }
        Update: {
          action?: string
          admin_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
        }
        Relationships: []
      }
      email_reminders: {
        Row: {
          id: string
          period_key: string
          reminder_type: string
          sent_at: string
          target_id: string
        }
        Insert: {
          id?: string
          period_key?: string
          reminder_type: string
          sent_at?: string
          target_id: string
        }
        Update: {
          id?: string
          period_key?: string
          reminder_type?: string
          sent_at?: string
          target_id?: string
        }
        Relationships: []
      }
      intake_session_categories: {
        Row: {
          category_id: string
          created_at: string
          session_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          session_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_session_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "medication_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_session_categories_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "intake_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_session_eligibility_results: {
        Row: {
          evaluated_at: string
          id: string
          medicine_id: string | null
          reason: string | null
          result: Database["public"]["Enums"]["eligibility_result"]
          session_id: string
        }
        Insert: {
          evaluated_at?: string
          id?: string
          medicine_id?: string | null
          reason?: string | null
          result: Database["public"]["Enums"]["eligibility_result"]
          session_id: string
        }
        Update: {
          evaluated_at?: string
          id?: string
          medicine_id?: string | null
          reason?: string | null
          result?: Database["public"]["Enums"]["eligibility_result"]
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_session_eligibility_results_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_session_eligibility_results_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "public_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_session_eligibility_results_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "intake_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_session_medicines: {
        Row: {
          category_id: string
          created_at: string
          medicine_id: string
          session_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          medicine_id: string
          session_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          medicine_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_session_medicines_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "medication_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_session_medicines_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_session_medicines_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "public_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_session_medicines_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "intake_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_session_questionnaire_responses: {
        Row: {
          answer_boolean: boolean | null
          answer_number: number | null
          answer_option_ids: string[]
          answer_text: string | null
          created_at: string
          id: string
          medicine_id: string | null
          question_id: string
          session_id: string
        }
        Insert: {
          answer_boolean?: boolean | null
          answer_number?: number | null
          answer_option_ids?: string[]
          answer_text?: string | null
          created_at?: string
          id?: string
          medicine_id?: string | null
          question_id: string
          session_id: string
        }
        Update: {
          answer_boolean?: boolean | null
          answer_number?: number | null
          answer_option_ids?: string[]
          answer_text?: string | null
          created_at?: string
          id?: string
          medicine_id?: string | null
          question_id?: string
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "intake_session_questionnaire_responses_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_session_questionnaire_responses_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "public_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_session_questionnaire_responses_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questionnaire_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "intake_session_questionnaire_responses_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "intake_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      intake_sessions: {
        Row: {
          apartment: string | null
          billing_apartment: string | null
          billing_city: string | null
          billing_postal_code: string | null
          billing_same_as_shipping: boolean
          billing_state_code: string | null
          billing_street_address: string | null
          city: string | null
          claimed_by_user_id: string | null
          created_at: string
          dob: string | null
          email: string | null
          expires_at: string
          full_name: string | null
          height_cm: number | null
          id: string
          marketing_consent: boolean
          phone: string | null
          postal_code: string | null
          selected_plan_id: string | null
          session_token: string
          sex: Database["public"]["Enums"]["sex_type"] | null
          sms_consent: boolean
          state_code: string | null
          status: Database["public"]["Enums"]["intake_session_status"]
          street_address: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          weight_kg: number | null
        }
        Insert: {
          apartment?: string | null
          billing_apartment?: string | null
          billing_city?: string | null
          billing_postal_code?: string | null
          billing_same_as_shipping?: boolean
          billing_state_code?: string | null
          billing_street_address?: string | null
          city?: string | null
          claimed_by_user_id?: string | null
          created_at?: string
          dob?: string | null
          email?: string | null
          expires_at?: string
          full_name?: string | null
          height_cm?: number | null
          id?: string
          marketing_consent?: boolean
          phone?: string | null
          postal_code?: string | null
          selected_plan_id?: string | null
          session_token: string
          sex?: Database["public"]["Enums"]["sex_type"] | null
          sms_consent?: boolean
          state_code?: string | null
          status?: Database["public"]["Enums"]["intake_session_status"]
          street_address?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          weight_kg?: number | null
        }
        Update: {
          apartment?: string | null
          billing_apartment?: string | null
          billing_city?: string | null
          billing_postal_code?: string | null
          billing_same_as_shipping?: boolean
          billing_state_code?: string | null
          billing_street_address?: string | null
          city?: string | null
          claimed_by_user_id?: string | null
          created_at?: string
          dob?: string | null
          email?: string | null
          expires_at?: string
          full_name?: string | null
          height_cm?: number | null
          id?: string
          marketing_consent?: boolean
          phone?: string | null
          postal_code?: string | null
          selected_plan_id?: string | null
          session_token?: string
          sex?: Database["public"]["Enums"]["sex_type"] | null
          sms_consent?: boolean
          state_code?: string | null
          status?: Database["public"]["Enums"]["intake_session_status"]
          street_address?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "intake_sessions_selected_plan_id_fkey"
            columns: ["selected_plan_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_categories: {
        Row: {
          created_at: string
          description: string | null
          eligibility_rules: Json
          icon: string | null
          id: string
          image_url: string | null
          is_active: boolean
          name: string
          slug: string
          sort_order: number
          tagline: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          eligibility_rules?: Json
          icon?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name: string
          slug: string
          sort_order?: number
          tagline?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          eligibility_rules?: Json
          icon?: string | null
          id?: string
          image_url?: string | null
          is_active?: boolean
          name?: string
          slug?: string
          sort_order?: number
          tagline?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      medication_category_medicines: {
        Row: {
          category_id: string
          created_at: string
          medicine_id: string
          sort_order: number
        }
        Insert: {
          category_id: string
          created_at?: string
          medicine_id: string
          sort_order?: number
        }
        Update: {
          category_id?: string
          created_at?: string
          medicine_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "medication_category_medicines_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "medication_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_category_medicines_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_category_medicines_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "public_medicines"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_relationships: {
        Row: {
          created_at: string
          id: string
          medicine_a_id: string
          medicine_b_id: string
          reason: string | null
          relationship: Database["public"]["Enums"]["medication_relationship"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          medicine_a_id: string
          medicine_b_id: string
          reason?: string | null
          relationship: Database["public"]["Enums"]["medication_relationship"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          medicine_a_id?: string
          medicine_b_id?: string
          reason?: string | null
          relationship?: Database["public"]["Enums"]["medication_relationship"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medication_relationships_medicine_a_id_fkey"
            columns: ["medicine_a_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_relationships_medicine_a_id_fkey"
            columns: ["medicine_a_id"]
            isOneToOne: false
            referencedRelation: "public_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_relationships_medicine_b_id_fkey"
            columns: ["medicine_b_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_relationships_medicine_b_id_fkey"
            columns: ["medicine_b_id"]
            isOneToOne: false
            referencedRelation: "public_medicines"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_request_events: {
        Row: {
          actor_role: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          request_id: string
          status: string
        }
        Insert: {
          actor_role?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          request_id: string
          status: string
        }
        Update: {
          actor_role?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          request_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "medication_request_events_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "medication_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_request_notes: {
        Row: {
          author_id: string
          author_role: string
          body: string
          created_at: string
          id: string
          request_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          author_role?: string
          body: string
          created_at?: string
          id?: string
          request_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          author_role?: string
          body?: string
          created_at?: string
          id?: string
          request_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medication_request_notes_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "medication_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      medication_requests: {
        Row: {
          billing_period_end: string | null
          claim_locked_at: string | null
          claim_locked_by: string | null
          consultation_mode: string | null
          consultation_scheduled_at: string | null
          created_at: string
          decision_at: string | null
          decision_by: string | null
          decision_note: string | null
          id: string
          kind: string
          life_file_error: string | null
          life_file_order_id: string | null
          life_file_pharmacy_id: string | null
          life_file_status: string | null
          life_file_submitted_at: string | null
          medicine_id: string | null
          order_group_id: string
          package_id: string | null
          payment_id: string | null
          plan_change_deadline: string | null
          plan_change_delta_cents: number | null
          plan_change_token: string | null
          previous_medicine_id: string | null
          previous_package_id: string | null
          previous_variant_id: string | null
          provider_id: string | null
          requires_consultation: boolean
          session_id: string | null
          status: string
          stripe_invoice_id: string | null
          stripe_refund_id: string | null
          subscription_id: string | null
          tracking_number: string | null
          updated_at: string
          user_id: string | null
          variant_id: string | null
        }
        Insert: {
          billing_period_end?: string | null
          claim_locked_at?: string | null
          claim_locked_by?: string | null
          consultation_mode?: string | null
          consultation_scheduled_at?: string | null
          created_at?: string
          decision_at?: string | null
          decision_by?: string | null
          decision_note?: string | null
          id?: string
          kind?: string
          life_file_error?: string | null
          life_file_order_id?: string | null
          life_file_pharmacy_id?: string | null
          life_file_status?: string | null
          life_file_submitted_at?: string | null
          medicine_id?: string | null
          order_group_id?: string
          package_id?: string | null
          payment_id?: string | null
          plan_change_deadline?: string | null
          plan_change_delta_cents?: number | null
          plan_change_token?: string | null
          previous_medicine_id?: string | null
          previous_package_id?: string | null
          previous_variant_id?: string | null
          provider_id?: string | null
          requires_consultation?: boolean
          session_id?: string | null
          status?: string
          stripe_invoice_id?: string | null
          stripe_refund_id?: string | null
          subscription_id?: string | null
          tracking_number?: string | null
          updated_at?: string
          user_id?: string | null
          variant_id?: string | null
        }
        Update: {
          billing_period_end?: string | null
          claim_locked_at?: string | null
          claim_locked_by?: string | null
          consultation_mode?: string | null
          consultation_scheduled_at?: string | null
          created_at?: string
          decision_at?: string | null
          decision_by?: string | null
          decision_note?: string | null
          id?: string
          kind?: string
          life_file_error?: string | null
          life_file_order_id?: string | null
          life_file_pharmacy_id?: string | null
          life_file_status?: string | null
          life_file_submitted_at?: string | null
          medicine_id?: string | null
          order_group_id?: string
          package_id?: string | null
          payment_id?: string | null
          plan_change_deadline?: string | null
          plan_change_delta_cents?: number | null
          plan_change_token?: string | null
          previous_medicine_id?: string | null
          previous_package_id?: string | null
          previous_variant_id?: string | null
          provider_id?: string | null
          requires_consultation?: boolean
          session_id?: string | null
          status?: string
          stripe_invoice_id?: string | null
          stripe_refund_id?: string | null
          subscription_id?: string | null
          tracking_number?: string | null
          updated_at?: string
          user_id?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medication_requests_life_file_pharmacy_id_fkey"
            columns: ["life_file_pharmacy_id"]
            isOneToOne: false
            referencedRelation: "life_file_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_requests_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_requests_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "public_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_requests_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_requests_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_requests_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_requests_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_requests_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "intake_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_requests_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_requests_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medication_requests_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "medicine_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      life_file_pharmacies: {
        Row: {
          api_base_url: string
          api_network_id: string | null
          api_password: string | null
          api_username: string | null
          created_at: string
          id: string
          is_active: boolean
          location_id: string | null
          name: string
          practice_id: number | null
          updated_at: string
          vendor_id: string | null
        }
        Insert: {
          api_base_url: string
          api_network_id?: string | null
          api_password?: string | null
          api_username?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          location_id?: string | null
          name: string
          practice_id?: number | null
          updated_at?: string
          vendor_id?: string | null
        }
        Update: {
          api_base_url?: string
          api_network_id?: string | null
          api_password?: string | null
          api_username?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          location_id?: string | null
          name?: string
          practice_id?: number | null
          updated_at?: string
          vendor_id?: string | null
        }
        Relationships: []
      }
      medicine_life_file_products: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          lf_product_id: number
          medicine_id: string
          pharmacy_id: string
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          lf_product_id: number
          medicine_id: string
          pharmacy_id: string
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          lf_product_id?: number
          medicine_id?: string
          pharmacy_id?: string
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "medicine_life_file_products_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicine_life_file_products_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "life_file_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicine_life_file_products_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "medicine_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      medicine_variants: {
        Row: {
          created_at: string
          from_price_cents: number | null
          id: string
          is_active: boolean
          lf_product_id: number | null
          medicine_id: string
          name: string
          sort_order: number
          stripe_product_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          from_price_cents?: number | null
          id?: string
          is_active?: boolean
          lf_product_id?: number | null
          medicine_id: string
          name: string
          sort_order?: number
          stripe_product_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          from_price_cents?: number | null
          id?: string
          is_active?: boolean
          lf_product_id?: number | null
          medicine_id?: string
          name?: string
          sort_order?: number
          stripe_product_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "medicine_variants_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medicine_variants_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "public_medicines"
            referencedColumns: ["id"]
          },
        ]
      }
      medicines: {
        Row: {
          created_at: string
          from_price_cents: number | null
          id: string
          image_url: string | null
          important_info: Json
          is_active: boolean
          lf_product_id: number | null
          long_description: string | null
          name: string
          notice_text: string | null
          requires_consultation: boolean
          requires_followup: boolean
          requires_questionnaire: boolean
          show_to_providers: boolean
          short_description: string
          sort_order: number
          status: Database["public"]["Enums"]["medicine_status"]
          stripe_product_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          from_price_cents?: number | null
          id?: string
          image_url?: string | null
          important_info?: Json
          is_active?: boolean
          lf_product_id?: number | null
          long_description?: string | null
          name: string
          notice_text?: string | null
          requires_consultation?: boolean
          requires_followup?: boolean
          requires_questionnaire?: boolean
          show_to_providers?: boolean
          short_description: string
          sort_order?: number
          status?: Database["public"]["Enums"]["medicine_status"]
          stripe_product_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          from_price_cents?: number | null
          id?: string
          image_url?: string | null
          important_info?: Json
          is_active?: boolean
          lf_product_id?: number | null
          long_description?: string | null
          name?: string
          notice_text?: string | null
          requires_consultation?: boolean
          requires_followup?: boolean
          requires_questionnaire?: boolean
          show_to_providers?: boolean
          short_description?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["medicine_status"]
          stripe_product_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          entity_id: string | null
          id: string
          link: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          entity_id?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          entity_id?: string | null
          id?: string
          link?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      packages: {
        Row: {
          clinical_note: string | null
          created_at: string
          duration_months: number
          features: Json
          id: string
          is_active: boolean
          is_most_popular: boolean
          medicine_id: string
          name: string
          original_price: number
          price: number
          sort_order: number
          stripe_price_id: string | null
          updated_at: string
          variant_id: string | null
        }
        Insert: {
          clinical_note?: string | null
          created_at?: string
          duration_months: number
          features?: Json
          id?: string
          is_active?: boolean
          is_most_popular?: boolean
          medicine_id: string
          name: string
          original_price?: number
          price?: number
          sort_order?: number
          stripe_price_id?: string | null
          updated_at?: string
          variant_id?: string | null
        }
        Update: {
          clinical_note?: string | null
          created_at?: string
          duration_months?: number
          features?: Json
          id?: string
          is_active?: boolean
          is_most_popular?: boolean
          medicine_id?: string
          name?: string
          original_price?: number
          price?: number
          sort_order?: number
          stripe_price_id?: string | null
          updated_at?: string
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "packages_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packages_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "public_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "packages_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "medicine_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_feedback: {
        Row: {
          category: string
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          intake_session_id: string | null
          message: string
          page_path: string | null
          resolved_at: string | null
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          category?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          intake_session_id?: string | null
          message: string
          page_path?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          category?: string
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          intake_session_id?: string | null
          message?: string
          page_path?: string | null
          resolved_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "patient_feedback_intake_session_id_fkey"
            columns: ["intake_session_id"]
            isOneToOne: false
            referencedRelation: "intake_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_feedback_replies: {
        Row: {
          author_role: string
          author_user_id: string | null
          body: string
          created_at: string
          feedback_id: string
          id: string
        }
        Insert: {
          author_role: string
          author_user_id?: string | null
          body: string
          created_at?: string
          feedback_id: string
          id?: string
        }
        Update: {
          author_role?: string
          author_user_id?: string | null
          body?: string
          created_at?: string
          feedback_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_feedback_replies_feedback_id_fkey"
            columns: ["feedback_id"]
            isOneToOne: false
            referencedRelation: "patient_feedback"
            referencedColumns: ["id"]
          },
        ]
      }
      patient_consultations: {
        Row: {
          created_at: string
          ended_at: string | null
          id: string
          qb_appointment_id: string
          qb_dialog_id: string | null
          qb_user_id: number
          started_at: string
          subscription_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          id?: string
          qb_appointment_id: string
          qb_dialog_id?: string | null
          qb_user_id: number
          started_at?: string
          subscription_id: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          id?: string
          qb_appointment_id?: string
          qb_dialog_id?: string | null
          qb_user_id?: number
          started_at?: string
          subscription_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "patient_consultations_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: true
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          id: string
          plan_id: string | null
          raw_event: Json | null
          session_id: string | null
          status: Database["public"]["Enums"]["payment_status"]
          stripe_customer_id: string | null
          stripe_invoice_id: string | null
          stripe_payment_intent_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          id?: string
          plan_id?: string | null
          raw_event?: Json | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          id?: string
          plan_id?: string | null
          raw_event?: Json | null
          session_id?: string | null
          status?: Database["public"]["Enums"]["payment_status"]
          stripe_customer_id?: string | null
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payments_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "intake_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      portal_offers: {
        Row: {
          badge_text: string | null
          created_at: string
          cta_href: string
          cta_label: string
          ends_at: string | null
          headline: string
          id: string
          is_active: boolean
          promo_code_id: string | null
          sort_order: number
          starts_at: string | null
          updated_at: string
        }
        Insert: {
          badge_text?: string | null
          created_at?: string
          cta_href?: string
          cta_label?: string
          ends_at?: string | null
          headline: string
          id?: string
          is_active?: boolean
          promo_code_id?: string | null
          sort_order?: number
          starts_at?: string | null
          updated_at?: string
        }
        Update: {
          badge_text?: string | null
          created_at?: string
          cta_href?: string
          cta_label?: string
          ends_at?: string | null
          headline?: string
          id?: string
          is_active?: boolean
          promo_code_id?: string | null
          sort_order?: number
          starts_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "portal_offers_promo_code_id_fkey"
            columns: ["promo_code_id"]
            isOneToOne: false
            referencedRelation: "promo_codes"
            referencedColumns: ["id"]
          },
        ]
      }
      prescriptions: {
        Row: {
          created_at: string
          directions: string | null
          document_url: string | null
          id: string
          medicine_id: string | null
          medicine_name: string
          package_id: string | null
          provider_id: string | null
          request_id: string
          status: string
          updated_at: string
          user_id: string | null
          variant_id: string | null
        }
        Insert: {
          created_at?: string
          directions?: string | null
          document_url?: string | null
          id?: string
          medicine_id?: string | null
          medicine_name: string
          package_id?: string | null
          provider_id?: string | null
          request_id: string
          status?: string
          updated_at?: string
          user_id?: string | null
          variant_id?: string | null
        }
        Update: {
          created_at?: string
          directions?: string | null
          document_url?: string | null
          id?: string
          medicine_id?: string | null
          medicine_name?: string
          package_id?: string | null
          provider_id?: string | null
          request_id?: string
          status?: string
          updated_at?: string
          user_id?: string | null
          variant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prescriptions_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "public_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_directory"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_request_id_fkey"
            columns: ["request_id"]
            isOneToOne: false
            referencedRelation: "medication_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prescriptions_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "medicine_variants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          apartment: string | null
          avatar_url: string | null
          city: string | null
          country: string | null
          created_at: string
          dob: string | null
          email: string
          full_name: string
          id: string
          marketing_consent: boolean
          phone: string | null
          postal_code: string | null
          referral_code: string | null
          sex: Database["public"]["Enums"]["sex_type"] | null
          sms_consent: boolean
          state_code: string | null
          street_address: string | null
          stripe_customer_id: string | null
          updated_at: string
        }
        Insert: {
          apartment?: string | null
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          dob?: string | null
          email: string
          full_name: string
          id: string
          marketing_consent?: boolean
          phone?: string | null
          postal_code?: string | null
          referral_code?: string | null
          sex?: Database["public"]["Enums"]["sex_type"] | null
          sms_consent?: boolean
          state_code?: string | null
          street_address?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          apartment?: string | null
          avatar_url?: string | null
          city?: string | null
          country?: string | null
          created_at?: string
          dob?: string | null
          email?: string
          full_name?: string
          id?: string
          marketing_consent?: boolean
          phone?: string | null
          postal_code?: string | null
          referral_code?: string | null
          sex?: Database["public"]["Enums"]["sex_type"] | null
          sms_consent?: boolean
          state_code?: string | null
          street_address?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      promo_codes: {
        Row: {
          amount_off_cents: number | null
          auto_apply: boolean
          code: string
          created_at: string
          currency: string
          discount_type: string
          duration: string
          duration_in_months: number | null
          id: string
          is_active: boolean
          max_redemptions: number | null
          percent_off: number | null
          redeem_by: string | null
          stripe_coupon_id: string | null
          stripe_promotion_code_id: string | null
          times_redeemed: number
          updated_at: string
        }
        Insert: {
          amount_off_cents?: number | null
          auto_apply?: boolean
          code: string
          created_at?: string
          currency?: string
          discount_type: string
          duration?: string
          duration_in_months?: number | null
          id?: string
          is_active?: boolean
          max_redemptions?: number | null
          percent_off?: number | null
          redeem_by?: string | null
          stripe_coupon_id?: string | null
          stripe_promotion_code_id?: string | null
          times_redeemed?: number
          updated_at?: string
        }
        Update: {
          amount_off_cents?: number | null
          auto_apply?: boolean
          code?: string
          created_at?: string
          currency?: string
          discount_type?: string
          duration?: string
          duration_in_months?: number | null
          id?: string
          is_active?: boolean
          max_redemptions?: number | null
          percent_off?: number | null
          redeem_by?: string | null
          stripe_coupon_id?: string | null
          stripe_promotion_code_id?: string | null
          times_redeemed?: number
          updated_at?: string
        }
        Relationships: []
      }
      providers: {
        Row: {
          address_line1: string | null
          address_line2: string | null
          bio: string | null
          city: string | null
          consultation_types: string[]
          country: string
          created_at: string
          credentials: string | null
          dea: string | null
          id: string
          availability_note: string | null
          is_active: boolean
          is_default: boolean
          is_unavailable: boolean
          languages: string[]
          license_number: string | null
          license_states: string[]
          npi: string | null
          practice_states: string[]
          qb_user_id: number | null
          specialty: string | null
          state: string | null
          updated_at: string
          years_experience: number | null
          zip: string | null
        }
        Insert: {
          address_line1?: string | null
          address_line2?: string | null
          availability_note?: string | null
          bio?: string | null
          city?: string | null
          consultation_types?: string[]
          country?: string
          created_at?: string
          credentials?: string | null
          dea?: string | null
          id: string
          is_active?: boolean
          is_default?: boolean
          is_unavailable?: boolean
          languages?: string[]
          license_number?: string | null
          license_states?: string[]
          npi?: string | null
          practice_states?: string[]
          qb_user_id?: number | null
          specialty?: string | null
          state?: string | null
          updated_at?: string
          years_experience?: number | null
          zip?: string | null
        }
        Update: {
          address_line1?: string | null
          address_line2?: string | null
          availability_note?: string | null
          bio?: string | null
          city?: string | null
          consultation_types?: string[]
          country?: string
          created_at?: string
          credentials?: string | null
          dea?: string | null
          id?: string
          is_active?: boolean
          is_default?: boolean
          is_unavailable?: boolean
          languages?: string[]
          license_number?: string | null
          license_states?: string[]
          npi?: string | null
          practice_states?: string[]
          qb_user_id?: number | null
          specialty?: string | null
          state?: string | null
          updated_at?: string
          years_experience?: number | null
          zip?: string | null
        }
        Relationships: []
      }
      provider_life_file_credentials: {
        Row: {
          api_base_url: string | null
          api_password: string
          api_username: string
          created_at: string
          id: string
          is_active: boolean
          npi: string | null
          pharmacy_id: string
          practice_id: number | null
          provider_id: string
          provider_life_file_id: string | null
          updated_at: string
        }
        Insert: {
          api_base_url?: string | null
          api_password: string
          api_username: string
          created_at?: string
          id?: string
          is_active?: boolean
          npi?: string | null
          pharmacy_id: string
          practice_id?: number | null
          provider_id: string
          provider_life_file_id?: string | null
          updated_at?: string
        }
        Update: {
          api_base_url?: string | null
          api_password?: string
          api_username?: string
          created_at?: string
          id?: string
          is_active?: boolean
          npi?: string | null
          pharmacy_id?: string
          practice_id?: number | null
          provider_id?: string
          provider_life_file_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_life_file_credentials_pharmacy_id_fkey"
            columns: ["pharmacy_id"]
            isOneToOne: false
            referencedRelation: "life_file_pharmacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_life_file_credentials_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      questionnaire_categories: {
        Row: {
          category_id: string
          created_at: string
          questionnaire_id: string
        }
        Insert: {
          category_id: string
          created_at?: string
          questionnaire_id: string
        }
        Update: {
          category_id?: string
          created_at?: string
          questionnaire_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "questionnaire_categories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: true
            referencedRelation: "medication_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questionnaire_categories_questionnaire_id_fkey"
            columns: ["questionnaire_id"]
            isOneToOne: false
            referencedRelation: "questionnaires"
            referencedColumns: ["id"]
          },
        ]
      }
      questionnaire_question_options: {
        Row: {
          created_at: string
          id: string
          is_disqualifying: boolean
          label: string
          question_id: string
          sort_order: number
          value: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_disqualifying?: boolean
          label: string
          question_id: string
          sort_order?: number
          value?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_disqualifying?: boolean
          label?: string
          question_id?: string
          sort_order?: number
          value?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "questionnaire_question_options_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questionnaire_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      questionnaire_questions: {
        Row: {
          created_at: string
          description: string | null
          disqualify_rules: Json
          id: string
          is_required: boolean
          prompt: string
          question_type: Database["public"]["Enums"]["q_question_type"]
          questionnaire_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          disqualify_rules?: Json
          id?: string
          is_required?: boolean
          prompt: string
          question_type: Database["public"]["Enums"]["q_question_type"]
          questionnaire_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          disqualify_rules?: Json
          id?: string
          is_required?: boolean
          prompt?: string
          question_type?: Database["public"]["Enums"]["q_question_type"]
          questionnaire_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "questionnaire_questions_questionnaire_id_fkey"
            columns: ["questionnaire_id"]
            isOneToOne: false
            referencedRelation: "questionnaires"
            referencedColumns: ["id"]
          },
        ]
      }
      questionnaires: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      referrals: {
        Row: {
          code: string
          converted_at: string | null
          created_at: string
          id: string
          referred_user_id: string | null
          referrer_user_id: string
          reward_cents: number
          status: string
          stripe_balance_txn_id: string | null
        }
        Insert: {
          code: string
          converted_at?: string | null
          created_at?: string
          id?: string
          referred_user_id?: string | null
          referrer_user_id: string
          reward_cents?: number
          status?: string
          stripe_balance_txn_id?: string | null
        }
        Update: {
          code?: string
          converted_at?: string | null
          created_at?: string
          id?: string
          referred_user_id?: string | null
          referrer_user_id?: string
          reward_cents?: number
          status?: string
          stripe_balance_txn_id?: string | null
        }
        Relationships: []
      }
      refund_requests: {
        Row: {
          admin_note: string | null
          amount_cents: number
          created_at: string
          id: string
          payment_id: string
          reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          stripe_refund_id: string | null
          subscription_id: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          admin_note?: string | null
          amount_cents: number
          created_at?: string
          id?: string
          payment_id: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          stripe_refund_id?: string | null
          subscription_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          admin_note?: string | null
          amount_cents?: number
          created_at?: string
          id?: string
          payment_id?: string
          reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          stripe_refund_id?: string | null
          subscription_id?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refund_requests_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refund_requests_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_checkout_events: {
        Row: {
          created_at: string
          event_type: string
          id: string
          order_id: string
          payload: Json
        }
        Insert: {
          created_at?: string
          event_type: string
          id?: string
          order_id: string
          payload?: Json
        }
        Update: {
          created_at?: string
          event_type?: string
          id?: string
          order_id?: string
          payload?: Json
        }
        Relationships: [
          {
            foreignKeyName: "shop_checkout_events_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "shop_checkout_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_checkout_order_items: {
        Row: {
          created_at: string
          description: string
          id: string
          image_url: string | null
          line_total: number
          medicine_id: string
          name: string
          order_id: string
          package_id: string | null
          quantity: number
          unit_price: number
        }
        Insert: {
          created_at?: string
          description: string
          id?: string
          image_url?: string | null
          line_total: number
          medicine_id: string
          name: string
          order_id: string
          package_id?: string | null
          quantity?: number
          unit_price: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          image_url?: string | null
          line_total?: number
          medicine_id?: string
          name?: string
          order_id?: string
          package_id?: string | null
          quantity?: number
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "shop_checkout_order_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_checkout_order_items_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "public_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_checkout_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "shop_checkout_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_checkout_order_items_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_checkout_orders: {
        Row: {
          consultation: number
          created_at: string
          id: string
          medicine_id: string
          payment_method_code: string
          promo_code: string | null
          promo_savings: number
          selected_package_id: string | null
          selected_plan_code: string
          shipping: number
          status: string
          stripe_invoice_id: string | null
          stripe_payment_intent_id: string | null
          stripe_subscription_id: string | null
          subtotal: number
          total: number
          updated_at: string
          user_id: string
        }
        Insert: {
          consultation?: number
          created_at?: string
          id?: string
          medicine_id: string
          payment_method_code: string
          promo_code?: string | null
          promo_savings?: number
          selected_package_id?: string | null
          selected_plan_code: string
          shipping?: number
          status?: string
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_subscription_id?: string | null
          subtotal: number
          total: number
          updated_at?: string
          user_id: string
        }
        Update: {
          consultation?: number
          created_at?: string
          id?: string
          medicine_id?: string
          payment_method_code?: string
          promo_code?: string | null
          promo_savings?: number
          selected_package_id?: string | null
          selected_plan_code?: string
          shipping?: number
          status?: string
          stripe_invoice_id?: string | null
          stripe_payment_intent_id?: string | null
          stripe_subscription_id?: string | null
          subtotal?: number
          total?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_checkout_orders_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_checkout_orders_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "public_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_checkout_orders_selected_package_id_fkey"
            columns: ["selected_package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_events: {
        Row: {
          id: string
          payload: Json
          received_at: string
          stripe_event_id: string
          type: string
        }
        Insert: {
          id?: string
          payload: Json
          received_at?: string
          stripe_event_id: string
          type: string
        }
        Update: {
          id?: string
          payload?: Json
          received_at?: string
          stripe_event_id?: string
          type?: string
        }
        Relationships: []
      }
      subscription_cancellation_feedback: {
        Row: {
          created_at: string
          id: string
          other_text: string | null
          reasons: string[]
          stripe_subscription_id: string
          subscription_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          other_text?: string | null
          reasons: string[]
          stripe_subscription_id: string
          subscription_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          other_text?: string | null
          reasons?: string[]
          stripe_subscription_id?: string
          subscription_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_cancellation_feedback_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          created_at: string
          current_period_end: string | null
          id: string
          medicine_id: string | null
          package_id: string | null
          session_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          medicine_id?: string | null
          package_id?: string | null
          session_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          cancel_at_period_end?: boolean
          created_at?: string
          current_period_end?: string | null
          id?: string
          medicine_id?: string | null
          package_id?: string | null
          session_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "subscriptions_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_medicine_id_fkey"
            columns: ["medicine_id"]
            isOneToOne: false
            referencedRelation: "public_medicines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscriptions_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "intake_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      wallet_transactions: {
        Row: {
          amount_cents: number
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          idempotency_key: string | null
          referral_id: string | null
          stripe_invoice_id: string | null
          type: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          idempotency_key?: string | null
          referral_id?: string | null
          stripe_invoice_id?: string | null
          type: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          idempotency_key?: string | null
          referral_id?: string | null
          stripe_invoice_id?: string | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "wallet_transactions_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      provider_directory: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          credentials: string | null
          email: string | null
          full_name: string | null
          id: string | null
          is_active: boolean | null
          phone: string | null
          specialty: string | null
        }
        Relationships: []
      }
      public_medicines: {
        Row: {
          from_price_cents: number | null
          id: string | null
          image_url: string | null
          important_info: Json | null
          long_description: string | null
          name: string | null
          notice_text: string | null
          short_description: string | null
          sort_order: number | null
        }
        Insert: {
          from_price_cents?: number | null
          id?: string | null
          image_url?: string | null
          important_info?: Json | null
          long_description?: string | null
          name?: string | null
          notice_text?: string | null
          short_description?: string | null
          sort_order?: number | null
        }
        Update: {
          from_price_cents?: number | null
          id?: string | null
          image_url?: string | null
          important_info?: Json | null
          long_description?: string | null
          name?: string | null
          notice_text?: string | null
          short_description?: string | null
          sort_order?: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      get_my_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_user_portal: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      get_user_role: {
        Args: { _user_id: string }
        Returns: Database["public"]["Enums"]["app_role"]
      }
      has_password: { Args: never; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      increment_promo_redemption: {
        Args: { p_promo_id: string }
        Returns: number
      }
      recompute_medicine_from_price: {
        Args: { p_medicine_id: string }
        Returns: undefined
      }
      recompute_variant_from_price: {
        Args: { p_variant_id: string }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "provider" | "patient"
      bmi_band: "underweight" | "normal" | "overweight" | "obese"
      eligibility_result: "eligible" | "ineligible" | "needs_review"
      intake_session_status:
        | "in_progress"
        | "payment_pending"
        | "completed"
        | "abandoned"
      medication_relationship: "incompatible" | "restricted"
      medicine_status: "active" | "inactive" | "draft"
      payment_status: "pending" | "succeeded" | "failed" | "refunded"
      q_question_type:
        | "text"
        | "number"
        | "yes_no"
        | "single_choice"
        | "multi_choice"
      question_type: "short_text" | "mcq_single" | "mcq_multi"
      sex_type: "female" | "male" | "other"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "provider", "patient"],
      bmi_band: ["underweight", "normal", "overweight", "obese"],
      eligibility_result: ["eligible", "ineligible", "needs_review"],
      intake_session_status: [
        "in_progress",
        "payment_pending",
        "completed",
        "abandoned",
      ],
      medication_relationship: ["incompatible", "restricted"],
      medicine_status: ["active", "inactive", "draft"],
      payment_status: ["pending", "succeeded", "failed", "refunded"],
      q_question_type: [
        "text",
        "number",
        "yes_no",
        "single_choice",
        "multi_choice",
      ],
      question_type: ["short_text", "mcq_single", "mcq_multi"],
      sex_type: ["female", "male", "other"],
    },
  },
} as const
