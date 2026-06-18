IF OBJECT_ID('dbo.case_sequences', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.case_sequences (
    name NVARCHAR(120) NOT NULL PRIMARY KEY,
    last_value BIGINT NOT NULL DEFAULT 0,
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
END;

IF OBJECT_ID('dbo.historical_case_good', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.historical_case_good (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    case_number NVARCHAR(120) NOT NULL,
    pdf_name NVARCHAR(255) NOT NULL,
    category NVARCHAR(120) NOT NULL,
    category_slug NVARCHAR(120) NOT NULL,
    folder_path NVARCHAR(400) NOT NULL,
    rating NVARCHAR(20) NOT NULL DEFAULT 'good',
    feedback_text NVARCHAR(MAX) NOT NULL DEFAULT '',
    user_comment NVARCHAR(MAX) NOT NULL DEFAULT '',
    case_status NVARCHAR(60) NOT NULL DEFAULT 'AI Generated',
    expert_decision NVARCHAR(60) NOT NULL DEFAULT '',
    expert_rating NVARCHAR(40) NOT NULL DEFAULT '',
    expert_comment NVARCHAR(MAX) NOT NULL DEFAULT '',
    corrected_recommendation NVARCHAR(MAX) NOT NULL DEFAULT '',
    knowledge_value NVARCHAR(20) NOT NULL DEFAULT '',
    reviewer_name NVARCHAR(255) NOT NULL DEFAULT '',
    learning_eligible BIT NOT NULL DEFAULT 0,
    reference_type NVARCHAR(20) NOT NULL DEFAULT '',
    refer_historical_cases BIT NOT NULL DEFAULT 0,
    referenced_case_numbers NVARCHAR(MAX) NOT NULL DEFAULT '[]',
    case_payload NVARCHAR(MAX) NOT NULL,
    ai_response NVARCHAR(MAX) NOT NULL,
    reviewed_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE UNIQUE INDEX historical_case_good_case_number_uq ON dbo.historical_case_good (case_number);
  CREATE INDEX historical_case_good_category_slug_idx ON dbo.historical_case_good (category_slug, created_at DESC);
END;

IF OBJECT_ID('dbo.historical_case_bad', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.historical_case_bad (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    case_number NVARCHAR(120) NOT NULL,
    pdf_name NVARCHAR(255) NOT NULL,
    category NVARCHAR(120) NOT NULL,
    category_slug NVARCHAR(120) NOT NULL,
    folder_path NVARCHAR(400) NOT NULL,
    rating NVARCHAR(20) NOT NULL DEFAULT 'bad',
    feedback_text NVARCHAR(MAX) NOT NULL DEFAULT '',
    user_comment NVARCHAR(MAX) NOT NULL DEFAULT '',
    case_status NVARCHAR(60) NOT NULL DEFAULT 'AI Generated',
    expert_decision NVARCHAR(60) NOT NULL DEFAULT '',
    expert_rating NVARCHAR(40) NOT NULL DEFAULT '',
    expert_comment NVARCHAR(MAX) NOT NULL DEFAULT '',
    corrected_recommendation NVARCHAR(MAX) NOT NULL DEFAULT '',
    knowledge_value NVARCHAR(20) NOT NULL DEFAULT '',
    reviewer_name NVARCHAR(255) NOT NULL DEFAULT '',
    learning_eligible BIT NOT NULL DEFAULT 0,
    reference_type NVARCHAR(20) NOT NULL DEFAULT '',
    refer_historical_cases BIT NOT NULL DEFAULT 0,
    referenced_case_numbers NVARCHAR(MAX) NOT NULL DEFAULT '[]',
    case_payload NVARCHAR(MAX) NOT NULL,
    ai_response NVARCHAR(MAX) NOT NULL,
    reviewed_at DATETIME2 NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE UNIQUE INDEX historical_case_bad_case_number_uq ON dbo.historical_case_bad (case_number);
  CREATE INDEX historical_case_bad_category_slug_idx ON dbo.historical_case_bad (category_slug, created_at DESC);
END;

IF COL_LENGTH('dbo.historical_case_good', 'user_comment') IS NULL
  ALTER TABLE dbo.historical_case_good ADD user_comment NVARCHAR(MAX) NOT NULL DEFAULT '';
IF COL_LENGTH('dbo.historical_case_good', 'case_status') IS NULL
  ALTER TABLE dbo.historical_case_good ADD case_status NVARCHAR(60) NOT NULL DEFAULT 'AI Generated';
IF COL_LENGTH('dbo.historical_case_good', 'expert_decision') IS NULL
  ALTER TABLE dbo.historical_case_good ADD expert_decision NVARCHAR(60) NOT NULL DEFAULT '';
IF COL_LENGTH('dbo.historical_case_good', 'expert_rating') IS NULL
  ALTER TABLE dbo.historical_case_good ADD expert_rating NVARCHAR(40) NOT NULL DEFAULT '';
IF COL_LENGTH('dbo.historical_case_good', 'expert_comment') IS NULL
  ALTER TABLE dbo.historical_case_good ADD expert_comment NVARCHAR(MAX) NOT NULL DEFAULT '';
IF COL_LENGTH('dbo.historical_case_good', 'corrected_recommendation') IS NULL
  ALTER TABLE dbo.historical_case_good ADD corrected_recommendation NVARCHAR(MAX) NOT NULL DEFAULT '';
IF COL_LENGTH('dbo.historical_case_good', 'knowledge_value') IS NULL
  ALTER TABLE dbo.historical_case_good ADD knowledge_value NVARCHAR(20) NOT NULL DEFAULT '';
IF COL_LENGTH('dbo.historical_case_good', 'reviewer_name') IS NULL
  ALTER TABLE dbo.historical_case_good ADD reviewer_name NVARCHAR(255) NOT NULL DEFAULT '';
IF COL_LENGTH('dbo.historical_case_good', 'learning_eligible') IS NULL
  ALTER TABLE dbo.historical_case_good ADD learning_eligible BIT NOT NULL DEFAULT 0;
IF COL_LENGTH('dbo.historical_case_good', 'reference_type') IS NULL
  ALTER TABLE dbo.historical_case_good ADD reference_type NVARCHAR(20) NOT NULL DEFAULT '';
IF COL_LENGTH('dbo.historical_case_good', 'reviewed_at') IS NULL
  ALTER TABLE dbo.historical_case_good ADD reviewed_at DATETIME2 NULL;
IF COL_LENGTH('dbo.historical_case_good', 'updated_at') IS NULL
  ALTER TABLE dbo.historical_case_good ADD updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME();
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'historical_case_good_case_number_uq' AND object_id = OBJECT_ID('dbo.historical_case_good'))
  CREATE UNIQUE INDEX historical_case_good_case_number_uq ON dbo.historical_case_good (case_number);

IF COL_LENGTH('dbo.historical_case_bad', 'user_comment') IS NULL
  ALTER TABLE dbo.historical_case_bad ADD user_comment NVARCHAR(MAX) NOT NULL DEFAULT '';
IF COL_LENGTH('dbo.historical_case_bad', 'case_status') IS NULL
  ALTER TABLE dbo.historical_case_bad ADD case_status NVARCHAR(60) NOT NULL DEFAULT 'AI Generated';
IF COL_LENGTH('dbo.historical_case_bad', 'expert_decision') IS NULL
  ALTER TABLE dbo.historical_case_bad ADD expert_decision NVARCHAR(60) NOT NULL DEFAULT '';
IF COL_LENGTH('dbo.historical_case_bad', 'expert_rating') IS NULL
  ALTER TABLE dbo.historical_case_bad ADD expert_rating NVARCHAR(40) NOT NULL DEFAULT '';
IF COL_LENGTH('dbo.historical_case_bad', 'expert_comment') IS NULL
  ALTER TABLE dbo.historical_case_bad ADD expert_comment NVARCHAR(MAX) NOT NULL DEFAULT '';
IF COL_LENGTH('dbo.historical_case_bad', 'corrected_recommendation') IS NULL
  ALTER TABLE dbo.historical_case_bad ADD corrected_recommendation NVARCHAR(MAX) NOT NULL DEFAULT '';
IF COL_LENGTH('dbo.historical_case_bad', 'knowledge_value') IS NULL
  ALTER TABLE dbo.historical_case_bad ADD knowledge_value NVARCHAR(20) NOT NULL DEFAULT '';
IF COL_LENGTH('dbo.historical_case_bad', 'reviewer_name') IS NULL
  ALTER TABLE dbo.historical_case_bad ADD reviewer_name NVARCHAR(255) NOT NULL DEFAULT '';
IF COL_LENGTH('dbo.historical_case_bad', 'learning_eligible') IS NULL
  ALTER TABLE dbo.historical_case_bad ADD learning_eligible BIT NOT NULL DEFAULT 0;
IF COL_LENGTH('dbo.historical_case_bad', 'reference_type') IS NULL
  ALTER TABLE dbo.historical_case_bad ADD reference_type NVARCHAR(20) NOT NULL DEFAULT '';
IF COL_LENGTH('dbo.historical_case_bad', 'reviewed_at') IS NULL
  ALTER TABLE dbo.historical_case_bad ADD reviewed_at DATETIME2 NULL;
IF COL_LENGTH('dbo.historical_case_bad', 'updated_at') IS NULL
  ALTER TABLE dbo.historical_case_bad ADD updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME();
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'historical_case_bad_case_number_uq' AND object_id = OBJECT_ID('dbo.historical_case_bad'))
  CREATE UNIQUE INDEX historical_case_bad_case_number_uq ON dbo.historical_case_bad (case_number);

IF OBJECT_ID('dbo.product_catalog', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.product_catalog (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    app_category NVARCHAR(120) NOT NULL,
    app_category_slug NVARCHAR(120) NOT NULL,
    source_type NVARCHAR(40) NOT NULL,
    source_label NVARCHAR(255) NOT NULL,
    source_url NVARCHAR(500) NOT NULL,
    product_name NVARCHAR(255) NOT NULL,
    product_slug NVARCHAR(255) NOT NULL,
    sku NVARCHAR(120) NOT NULL DEFAULT '',
    brand NVARCHAR(120) NOT NULL DEFAULT '',
    product_url NVARCHAR(500) NOT NULL,
    price_text NVARCHAR(120) NOT NULL DEFAULT '',
    currency NVARCHAR(20) NOT NULL DEFAULT 'MYR',
    availability NVARCHAR(60) NOT NULL DEFAULT 'unknown',
    short_description NVARCHAR(MAX) NOT NULL DEFAULT '',
    specs_json NVARCHAR(MAX) NOT NULL DEFAULT '{}',
    category_trail NVARCHAR(MAX) NOT NULL DEFAULT '[]',
    searchable_text NVARCHAR(MAX) NOT NULL DEFAULT '',
    is_active BIT NOT NULL DEFAULT 1,
    source_updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    last_synced_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE UNIQUE INDEX product_catalog_product_url_uq ON dbo.product_catalog (product_url);
  CREATE INDEX product_catalog_app_category_slug_idx ON dbo.product_catalog (app_category_slug, is_active, last_synced_at DESC);
  CREATE INDEX product_catalog_brand_idx ON dbo.product_catalog (brand);
END;

IF OBJECT_ID('dbo.product_sync_runs', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.product_sync_runs (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    run_id NVARCHAR(120) NOT NULL,
    sync_scope NVARCHAR(120) NOT NULL,
    [status] NVARCHAR(40) NOT NULL,
    details_json NVARCHAR(MAX) NOT NULL DEFAULT '{}',
    started_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    finished_at DATETIME2 NULL
  );
  CREATE UNIQUE INDEX product_sync_runs_run_id_uq ON dbo.product_sync_runs (run_id);
  CREATE INDEX product_sync_runs_started_at_idx ON dbo.product_sync_runs (started_at DESC);
END;

IF OBJECT_ID('dbo.ai_run_logs', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.ai_run_logs (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    request_id NVARCHAR(120) NOT NULL,
    case_number NVARCHAR(120) NOT NULL DEFAULT '',
    category NVARCHAR(120) NOT NULL DEFAULT '',
    category_slug NVARCHAR(120) NOT NULL DEFAULT '',
    user_name NVARCHAR(255) NOT NULL DEFAULT '',
    model NVARCHAR(120) NOT NULL,
    prompt_version NVARCHAR(120) NOT NULL,
    [status] NVARCHAR(40) NOT NULL,
    latency_ms INT NOT NULL DEFAULT 0,
    input_chars INT NOT NULL DEFAULT 0,
    usage_json NVARCHAR(MAX) NOT NULL DEFAULT '{}',
    error_message NVARCHAR(MAX) NOT NULL DEFAULT '',
    [source] NVARCHAR(60) NOT NULL DEFAULT 'web',
    recommendation_json NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE UNIQUE INDEX ai_run_logs_request_id_uq ON dbo.ai_run_logs (request_id);
  CREATE INDEX ai_run_logs_created_at_idx ON dbo.ai_run_logs (created_at DESC);
  CREATE INDEX ai_run_logs_category_slug_idx ON dbo.ai_run_logs (category_slug, created_at DESC);
END;

IF OBJECT_ID('dbo.app_event_logs', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.app_event_logs (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    event_name NVARCHAR(120) NOT NULL,
    event_detail NVARCHAR(MAX) NOT NULL DEFAULT '',
    [level] NVARCHAR(20) NOT NULL DEFAULT 'info',
    case_number NVARCHAR(120) NOT NULL DEFAULT '',
    category NVARCHAR(120) NOT NULL DEFAULT '',
    category_slug NVARCHAR(120) NOT NULL DEFAULT '',
    request_id NVARCHAR(120) NOT NULL DEFAULT '',
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX app_event_logs_created_at_idx ON dbo.app_event_logs (created_at DESC);
END;

IF OBJECT_ID('dbo.eval_cases', 'U') IS NULL
BEGIN
  CREATE TABLE dbo.eval_cases (
    id BIGINT IDENTITY(1,1) PRIMARY KEY,
    case_number NVARCHAR(120) NOT NULL,
    category NVARCHAR(120) NOT NULL,
    category_slug NVARCHAR(120) NOT NULL,
    user_name NVARCHAR(255) NOT NULL DEFAULT '',
    rating NVARCHAR(40) NOT NULL DEFAULT '',
    evaluation_note NVARCHAR(MAX) NOT NULL DEFAULT '',
    source_run_request_id NVARCHAR(120) NOT NULL DEFAULT '',
    case_payload NVARCHAR(MAX) NOT NULL,
    ai_response NVARCHAR(MAX) NOT NULL,
    created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
  );
  CREATE INDEX eval_cases_created_at_idx ON dbo.eval_cases (created_at DESC);
END;
