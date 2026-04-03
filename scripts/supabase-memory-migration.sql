-- Knowtation Memory — Supabase Migration
-- Run this SQL in your Supabase SQL Editor to set up the memory events table.
-- Requires: pgvector extension (enabled by default on Supabase).
--
-- Usage:
--   1. Go to Supabase Dashboard → SQL Editor
--   2. Paste this file and run
--   3. Set in config/local.yaml:
--        memory:
--          enabled: true
--          provider: supabase
--          supabase_url: https://your-project.supabase.co
--          supabase_key: your-anon-key
--      Or env: KNOWTATION_SUPABASE_URL, KNOWTATION_SUPABASE_KEY

-- Enable pgvector if not already enabled
create extension if not exists vector;

-- Memory events table
create table if not exists knowtation_memory_events (
  id text primary key,
  type text not null,
  ts timestamptz not null default now(),
  vault_id text not null default 'default',
  data jsonb not null default '{}'::jsonb,
  ttl text,
  air_id text,
  embedding vector(1536)
);

-- Indexes for common queries
create index if not exists idx_kme_type on knowtation_memory_events (type);
create index if not exists idx_kme_vault_id on knowtation_memory_events (vault_id);
create index if not exists idx_kme_ts on knowtation_memory_events (ts desc);
create index if not exists idx_kme_vault_type_ts on knowtation_memory_events (vault_id, type, ts desc);

-- pgvector index for semantic search (IVFFlat; adjust lists for scale)
create index if not exists idx_kme_embedding on knowtation_memory_events
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- RPC function for vector similarity search (used by the Supabase provider)
create or replace function match_memory_events(
  query_embedding vector(1536),
  match_count int default 10,
  filter_vault_id text default 'default'
)
returns table (
  id text,
  type text,
  ts timestamptz,
  vault_id text,
  data jsonb,
  similarity float
)
language sql stable
as $$
  select
    id,
    type,
    ts,
    vault_id,
    data,
    1 - (embedding <=> query_embedding) as similarity
  from knowtation_memory_events
  where vault_id = filter_vault_id
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;

-- Row-level security (optional but recommended for multi-user hosted)
-- Uncomment and adapt if using Supabase Auth:
--
-- alter table knowtation_memory_events enable row level security;
--
-- create policy "Users can only access their own vault memories"
--   on knowtation_memory_events for all
--   using (vault_id = auth.jwt() ->> 'vault_id');
