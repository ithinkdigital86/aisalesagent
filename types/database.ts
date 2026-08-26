// types/database.ts
//
// Typed schema for the Cadence database. This mirrors the output of
//   supabase gen types typescript --linked
// but was authored by hand from supabase/migrations/0001_init.sql because the
// Supabase project is not reachable from the build environment. Regenerate with
// the CLI (overwriting this file) once you run it somewhere Supabase is allowed;
// the shapes below are kept in that exact format so the diff stays clean.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type Database = {
  public: {
    Tables: {
      actions: {
        Row: {
          agent: Database['public']['Enums']['agent_slug'];
          block_reason: string | null;
          body: string;
          channel: Database['public']['Enums']['channel'];
          clicked_at: string | null;
          consent_basis: Database['public']['Enums']['consent_basis'] | null;
          created_at: string;
          id: string;
          lead_id: string;
          opened_at: string | null;
          provider_message_id: string | null;
          replied_at: string | null;
          reply_body: string | null;
          reply_sentiment: string | null;
          scheduled_for: string | null;
          sent_at: string | null;
          sequence_id: string | null;
          status: Database['public']['Enums']['action_status'];
          step_number: number | null;
          subject: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          agent: Database['public']['Enums']['agent_slug'];
          block_reason?: string | null;
          body: string;
          channel: Database['public']['Enums']['channel'];
          clicked_at?: string | null;
          consent_basis?: Database['public']['Enums']['consent_basis'] | null;
          created_at?: string;
          id?: string;
          lead_id: string;
          opened_at?: string | null;
          provider_message_id?: string | null;
          replied_at?: string | null;
          reply_body?: string | null;
          reply_sentiment?: string | null;
          scheduled_for?: string | null;
          sent_at?: string | null;
          sequence_id?: string | null;
          status?: Database['public']['Enums']['action_status'];
          step_number?: number | null;
          subject?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          agent?: Database['public']['Enums']['agent_slug'];
          block_reason?: string | null;
          body?: string;
          channel?: Database['public']['Enums']['channel'];
          clicked_at?: string | null;
          consent_basis?: Database['public']['Enums']['consent_basis'] | null;
          created_at?: string;
          id?: string;
          lead_id?: string;
          opened_at?: string | null;
          provider_message_id?: string | null;
          replied_at?: string | null;
          reply_body?: string | null;
          reply_sentiment?: string | null;
          scheduled_for?: string | null;
          sent_at?: string | null;
          sequence_id?: string | null;
          status?: Database['public']['Enums']['action_status'];
          step_number?: number | null;
          subject?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'actions_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'actions_sequence_id_fkey';
            columns: ['sequence_id'];
            isOneToOne: false;
            referencedRelation: 'sequences';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'actions_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      agent_memory: {
        Row: {
          agent: Database['public']['Enums']['agent_slug'];
          confidence: number;
          content: string;
          created_at: string;
          id: string;
          memory_type: string;
          retired_at: string | null;
          sample_size: number;
          success_rate: number | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          agent: Database['public']['Enums']['agent_slug'];
          confidence?: number;
          content: string;
          created_at?: string;
          id?: string;
          memory_type: string;
          retired_at?: string | null;
          sample_size?: number;
          success_rate?: number | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          agent?: Database['public']['Enums']['agent_slug'];
          confidence?: number;
          content?: string;
          created_at?: string;
          id?: string;
          memory_type?: string;
          retired_at?: string | null;
          sample_size?: number;
          success_rate?: number | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'agent_memory_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      agent_runs: {
        Row: {
          agent: Database['public']['Enums']['agent_slug'];
          created_at: string;
          duration_ms: number | null;
          error: string | null;
          id: string;
          input_tokens: number;
          lead_id: string | null;
          model: string;
          ok: boolean;
          output_tokens: number;
          raw_output: Json | null;
          workspace_id: string;
        };
        Insert: {
          agent: Database['public']['Enums']['agent_slug'];
          created_at?: string;
          duration_ms?: number | null;
          error?: string | null;
          id?: string;
          input_tokens?: number;
          lead_id?: string | null;
          model: string;
          ok?: boolean;
          output_tokens?: number;
          raw_output?: Json | null;
          workspace_id: string;
        };
        Update: {
          agent?: Database['public']['Enums']['agent_slug'];
          created_at?: string;
          duration_ms?: number | null;
          error?: string | null;
          id?: string;
          input_tokens?: number;
          lead_id?: string | null;
          model?: string;
          ok?: boolean;
          output_tokens?: number;
          raw_output?: Json | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'agent_runs_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'agent_runs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      consent_records: {
        Row: {
          basis: Database['public']['Enums']['consent_basis'];
          captured_at: string;
          channels: Database['public']['Enums']['channel'][];
          created_at: string;
          evidence_url: string | null;
          expires_at: string | null;
          id: string;
          lead_id: string;
          revoked_at: string | null;
          source_description: string;
          workspace_id: string;
        };
        Insert: {
          basis: Database['public']['Enums']['consent_basis'];
          captured_at?: string;
          channels: Database['public']['Enums']['channel'][];
          created_at?: string;
          evidence_url?: string | null;
          expires_at?: string | null;
          id?: string;
          lead_id: string;
          revoked_at?: string | null;
          source_description: string;
          workspace_id: string;
        };
        Update: {
          basis?: Database['public']['Enums']['consent_basis'];
          captured_at?: string;
          channels?: Database['public']['Enums']['channel'][];
          created_at?: string;
          evidence_url?: string | null;
          expires_at?: string | null;
          id?: string;
          lead_id?: string;
          revoked_at?: string | null;
          source_description?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'consent_records_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'consent_records_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      enrichment_cache: {
        Row: {
          cache_key: string;
          expires_at: string;
          fetched_at: string;
          id: string;
          payload: Json;
          provider: string;
        };
        Insert: {
          cache_key: string;
          expires_at?: string;
          fetched_at?: string;
          id?: string;
          payload: Json;
          provider: string;
        };
        Update: {
          cache_key?: string;
          expires_at?: string;
          fetched_at?: string;
          id?: string;
          payload?: Json;
          provider?: string;
        };
        Relationships: [];
      };
      icp_profiles: {
        Row: {
          active: boolean;
          created_at: string;
          filters: Json;
          id: string;
          name: string;
          offer: string | null;
          trigger_types: string[];
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          filters?: Json;
          id?: string;
          name: string;
          offer?: string | null;
          trigger_types?: string[];
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          filters?: Json;
          id?: string;
          name?: string;
          offer?: string | null;
          trigger_types?: string[];
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'icp_profiles_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      lead_triggers: {
        Row: {
          created_at: string;
          decays_at: string | null;
          detected_at: string;
          headline: string;
          id: string;
          lead_id: string;
          raw: Json;
          trigger_type: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          decays_at?: string | null;
          detected_at?: string;
          headline: string;
          id?: string;
          lead_id: string;
          raw?: Json;
          trigger_type: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          decays_at?: string | null;
          detected_at?: string;
          headline?: string;
          id?: string;
          lead_id?: string;
          raw?: Json;
          trigger_type?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'lead_triggers_lead_id_fkey';
            columns: ['lead_id'];
            isOneToOne: false;
            referencedRelation: 'leads';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'lead_triggers_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      leads: {
        Row: {
          assigned_sequence_id: string | null;
          company_domain: string | null;
          company_name: string | null;
          country: string | null;
          created_at: string;
          dedupe_key: string | null;
          email: string | null;
          email_verified: boolean;
          employee_count: number | null;
          fit_reasoning: string | null;
          fit_score: number | null;
          full_name: string | null;
          icp_profile_id: string | null;
          id: string;
          industry: string | null;
          instagram_handle: string | null;
          last_contacted_at: string | null;
          linkedin_url: string | null;
          next_action_at: string | null;
          phone: string | null;
          raw: Json;
          seniority: string | null;
          sourcing_run_id: string | null;
          stage: Database['public']['Enums']['lead_stage'];
          timezone: string | null;
          title: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          assigned_sequence_id?: string | null;
          company_domain?: string | null;
          company_name?: string | null;
          country?: string | null;
          created_at?: string;
          dedupe_key?: string | null;
          email?: string | null;
          email_verified?: boolean;
          employee_count?: number | null;
          fit_reasoning?: string | null;
          fit_score?: number | null;
          full_name?: string | null;
          icp_profile_id?: string | null;
          id?: string;
          industry?: string | null;
          instagram_handle?: string | null;
          last_contacted_at?: string | null;
          linkedin_url?: string | null;
          next_action_at?: string | null;
          phone?: string | null;
          raw?: Json;
          seniority?: string | null;
          sourcing_run_id?: string | null;
          stage?: Database['public']['Enums']['lead_stage'];
          timezone?: string | null;
          title?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          assigned_sequence_id?: string | null;
          company_domain?: string | null;
          company_name?: string | null;
          country?: string | null;
          created_at?: string;
          dedupe_key?: string | null;
          email?: string | null;
          email_verified?: boolean;
          employee_count?: number | null;
          fit_reasoning?: string | null;
          fit_score?: number | null;
          full_name?: string | null;
          icp_profile_id?: string | null;
          id?: string;
          industry?: string | null;
          instagram_handle?: string | null;
          last_contacted_at?: string | null;
          linkedin_url?: string | null;
          next_action_at?: string | null;
          phone?: string | null;
          raw?: Json;
          seniority?: string | null;
          sourcing_run_id?: string | null;
          stage?: Database['public']['Enums']['lead_stage'];
          timezone?: string | null;
          title?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'leads_icp_profile_id_fkey';
            columns: ['icp_profile_id'];
            isOneToOne: false;
            referencedRelation: 'icp_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leads_sequence_fk';
            columns: ['assigned_sequence_id'];
            isOneToOne: false;
            referencedRelation: 'sequences';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leads_sourcing_run_id_fkey';
            columns: ['sourcing_run_id'];
            isOneToOne: false;
            referencedRelation: 'sourcing_runs';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leads_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      sequences: {
        Row: {
          active: boolean;
          created_at: string;
          id: string;
          meeting_count: number;
          name: string;
          reply_count: number;
          sent_count: number;
          steps: Json;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          id?: string;
          meeting_count?: number;
          name: string;
          reply_count?: number;
          sent_count?: number;
          steps?: Json;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          id?: string;
          meeting_count?: number;
          name?: string;
          reply_count?: number;
          sent_count?: number;
          steps?: Json;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'sequences_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      sourcing_runs: {
        Row: {
          created_at: string;
          credits_used: number;
          duplicate_count: number;
          error: string | null;
          filters_used: Json;
          icp_profile_id: string | null;
          id: string;
          inserted_count: number;
          returned_count: number;
          source: string;
          suppressed_count: number;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          credits_used?: number;
          duplicate_count?: number;
          error?: string | null;
          filters_used?: Json;
          icp_profile_id?: string | null;
          id?: string;
          inserted_count?: number;
          returned_count?: number;
          source: string;
          suppressed_count?: number;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          credits_used?: number;
          duplicate_count?: number;
          error?: string | null;
          filters_used?: Json;
          icp_profile_id?: string | null;
          id?: string;
          inserted_count?: number;
          returned_count?: number;
          source?: string;
          suppressed_count?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'sourcing_runs_icp_profile_id_fkey';
            columns: ['icp_profile_id'];
            isOneToOne: false;
            referencedRelation: 'icp_profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'sourcing_runs_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      suppression_list: {
        Row: {
          created_at: string;
          domain: string | null;
          email: string | null;
          id: string;
          phone: string | null;
          reason: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          domain?: string | null;
          email?: string | null;
          id?: string;
          phone?: string | null;
          reason: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          domain?: string | null;
          email?: string | null;
          id?: string;
          phone?: string | null;
          reason?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'suppression_list_workspace_id_fkey';
            columns: ['workspace_id'];
            isOneToOne: false;
            referencedRelation: 'workspaces';
            referencedColumns: ['id'];
          },
        ];
      };
      workspaces: {
        Row: {
          created_at: string;
          dlt_entity_id: string | null;
          dlt_registered: boolean;
          id: string;
          jurisdictions: string[];
          name: string;
          owner_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          dlt_entity_id?: string | null;
          dlt_registered?: boolean;
          id?: string;
          jurisdictions?: string[];
          name: string;
          owner_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          dlt_entity_id?: string | null;
          dlt_registered?: boolean;
          id?: string;
          jurisdictions?: string[];
          name?: string;
          owner_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: 'workspaces_owner_id_fkey';
            columns: ['owner_id'];
            isOneToOne: false;
            referencedRelation: 'users';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      owns_workspace: {
        Args: { ws: string };
        Returns: boolean;
      };
      set_updated_at: {
        Args: Record<PropertyKey, never>;
        Returns: unknown;
      };
    };
    Enums: {
      action_status: 'queued' | 'awaiting_approval' | 'sent' | 'failed' | 'blocked';
      agent_slug:
        | 'sales_manager'
        | 'qualifier'
        | 'content_creator'
        | 'follow_up'
        | 'email_specialist'
        | 'linkedin_specialist'
        | 'instagram_specialist'
        | 'voice_specialist'
        | 'sourcing_scout';
      channel: 'email' | 'sms' | 'voice' | 'linkedin' | 'instagram';
      consent_basis: 'written' | 'oral' | 'enquiry_implied' | 'legitimate_b2b' | 'none';
      lead_stage:
        | 'sourced'
        | 'qualified'
        | 'parked'
        | 'contacted'
        | 'engaged'
        | 'meeting_booked'
        | 'won'
        | 'lost'
        | 'suppressed';
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database['public'];

export type Tables<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Row'];

export type TablesInsert<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Insert'];

export type TablesUpdate<T extends keyof PublicSchema['Tables']> =
  PublicSchema['Tables'][T]['Update'];

export type Enums<T extends keyof PublicSchema['Enums']> = PublicSchema['Enums'][T];

export const Constants = {
  public: {
    Enums: {
      action_status: ['queued', 'awaiting_approval', 'sent', 'failed', 'blocked'],
      agent_slug: [
        'sales_manager',
        'qualifier',
        'content_creator',
        'follow_up',
        'email_specialist',
        'linkedin_specialist',
        'instagram_specialist',
        'voice_specialist',
        'sourcing_scout',
      ],
      channel: ['email', 'sms', 'voice', 'linkedin', 'instagram'],
      consent_basis: ['written', 'oral', 'enquiry_implied', 'legitimate_b2b', 'none'],
      lead_stage: [
        'sourced',
        'qualified',
        'parked',
        'contacted',
        'engaged',
        'meeting_booked',
        'won',
        'lost',
        'suppressed',
      ],
    },
  },
} as const;
