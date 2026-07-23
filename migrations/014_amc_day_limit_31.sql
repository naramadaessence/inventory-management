-- Migration 014: Allow AMC day to be up to 31
ALTER TABLE parties DROP CONSTRAINT IF EXISTS parties_amc_day_check;
ALTER TABLE parties ADD CONSTRAINT parties_amc_day_check CHECK (amc_day >= 1 AND amc_day <= 31);
