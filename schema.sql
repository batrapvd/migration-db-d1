-- D1 Database Schema for PostgreSQL to Cloudflare D1 migration
-- Created for migration from PostgreSQL to Cloudflare D1

-- ========================================
-- Table: coordinate_speed_new
-- ========================================
DROP TABLE IF EXISTS coordinate_speed_new;

CREATE TABLE coordinate_speed_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    api_speed_limit REAL,
    bearing REAL,
    display_name TEXT
);

-- Create indexes for better query performance
CREATE INDEX idx_coordinate_latitude_longitude ON coordinate_speed_new(latitude, longitude);
CREATE INDEX idx_coordinate_display_name ON coordinate_speed_new(display_name);

-- ========================================
-- Table: camera_locations
-- ========================================
DROP TABLE IF EXISTS camera_locations;

CREATE TABLE camera_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id TEXT,
    longitude REAL NOT NULL,
    latitude REAL NOT NULL,
    altitude REAL,
    created_at TEXT,
    updated_at TEXT
);

-- Create indexes for better query performance
CREATE INDEX idx_camera_location_id ON camera_locations(location_id);
CREATE INDEX idx_camera_latitude_longitude ON camera_locations(latitude, longitude);
CREATE INDEX idx_camera_created_at ON camera_locations(created_at);

-- ========================================
-- Table: migration_checkpoints
-- ========================================
-- Tracks migration progress for resume capability
DROP TABLE IF EXISTS migration_checkpoints;

CREATE TABLE migration_checkpoints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    start_id INTEGER NOT NULL,
    end_id INTEGER NOT NULL,
    records_processed INTEGER DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Create indexes for quick lookups
CREATE INDEX idx_checkpoint_table_status ON migration_checkpoints(table_name, status);
CREATE INDEX idx_checkpoint_table_range ON migration_checkpoints(table_name, start_id, end_id);
