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
