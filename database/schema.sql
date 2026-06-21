CREATE TABLE IF NOT EXISTS budgets (
  budget_month CHAR(7) NOT NULL,
  hn_amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
  hcm_amount BIGINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (budget_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS expenses (
  id VARCHAR(24) NOT NULL,
  branch ENUM('HN', 'HCM') NOT NULL,
  route VARCHAR(100) NOT NULL,
  category VARCHAR(100) NOT NULL,
  spent_by VARCHAR(100) NOT NULL,
  amount BIGINT UNSIGNED NOT NULL,
  expense_date DATE NOT NULL,
  note VARCHAR(1000) NOT NULL DEFAULT '',
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  INDEX idx_expense_date (expense_date),
  INDEX idx_branch_date (branch, expense_date),
  INDEX idx_route (route),
  INDEX idx_category (category),
  INDEX idx_spent_by (spent_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS receipts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  expense_id VARCHAR(24) NOT NULL,
  original_name VARCHAR(160) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_url VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  INDEX idx_receipt_expense (expense_id),
  CONSTRAINT fk_receipts_expense
    FOREIGN KEY (expense_id) REFERENCES expenses(id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
