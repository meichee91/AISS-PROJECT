create table if not exists case_sequences (
  name text primary key,
  last_value bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists historical_case_good (
  id bigint generated always as identity primary key,
  case_number text not null,
  pdf_name text not null,
  category text not null,
  category_slug text not null,
  folder_path text not null,
  rating text not null default 'good',
  feedback_text text not null default '',
  refer_historical_cases boolean not null default false,
  referenced_case_numbers jsonb not null default '[]'::jsonb,
  case_payload jsonb not null,
  ai_response jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists historical_case_good_category_slug_idx
  on historical_case_good (category_slug, created_at desc);

create table if not exists historical_case_bad (
  id bigint generated always as identity primary key,
  case_number text not null,
  pdf_name text not null,
  category text not null,
  category_slug text not null,
  folder_path text not null,
  rating text not null default 'bad',
  feedback_text text not null default '',
  refer_historical_cases boolean not null default false,
  referenced_case_numbers jsonb not null default '[]'::jsonb,
  case_payload jsonb not null,
  ai_response jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists historical_case_bad_category_slug_idx
  on historical_case_bad (category_slug, created_at desc);

create table if not exists product_catalog (
  id bigint generated always as identity primary key,
  app_category text not null,
  app_category_slug text not null,
  source_type text not null,
  source_label text not null,
  source_url text not null,
  product_name text not null,
  product_slug text not null,
  sku text not null default '',
  brand text not null default '',
  product_url text not null unique,
  price_text text not null default '',
  currency text not null default 'MYR',
  availability text not null default 'unknown',
  short_description text not null default '',
  specs_json jsonb not null default '{}'::jsonb,
  category_trail jsonb not null default '[]'::jsonb,
  searchable_text text not null default '',
  is_active boolean not null default true,
  source_updated_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now()
);

create index if not exists product_catalog_app_category_slug_idx
  on product_catalog (app_category_slug, is_active, last_synced_at desc);

create index if not exists product_catalog_brand_idx
  on product_catalog (brand);

create table if not exists product_sync_runs (
  id bigint generated always as identity primary key,
  run_id text not null unique,
  sync_scope text not null,
  status text not null,
  details_json jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists product_sync_runs_started_at_idx
  on product_sync_runs (started_at desc);

grant usage on schema public to service_role;
grant all privileges on table public.case_sequences to service_role;
grant all privileges on table public.historical_case_good to service_role;
grant all privileges on table public.historical_case_bad to service_role;
grant all privileges on table public.product_catalog to service_role;
grant all privileges on table public.product_sync_runs to service_role;
grant all privileges on all sequences in schema public to service_role;

alter table public.case_sequences disable row level security;
alter table public.historical_case_good disable row level security;
alter table public.historical_case_bad disable row level security;
alter table public.product_catalog disable row level security;
alter table public.product_sync_runs disable row level security;
