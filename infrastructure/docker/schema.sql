CREATE TABLE users (
  id CHAR(36) PRIMARY KEY,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user', 'admin') NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE jobs (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  image_path VARCHAR(255) NOT NULL,
  image_hash CHAR(64) NOT NULL,
  status ENUM('queued', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  available_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  lease_token CHAR(36) NULL,
  lease_until DATETIME(3) NULL,
  simulate_failure BOOLEAN NOT NULL DEFAULT FALSE,
  last_error VARCHAR(255) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX queue_idx (status, available_at, lease_until),
  INDEX owner_idx (user_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE assessments (
  id CHAR(36) PRIMARY KEY,
  job_id CHAR(36) NOT NULL UNIQUE,
  model_version VARCHAR(64) NOT NULL,
  outcome VARCHAR(32) NOT NULL,
  score DECIMAL(5, 4) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  FOREIGN KEY (job_id) REFERENCES jobs(id)
) ENGINE=InnoDB;
