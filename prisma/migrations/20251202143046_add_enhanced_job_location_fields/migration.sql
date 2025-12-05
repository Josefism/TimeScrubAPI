-- Add enhanced JobLocation fields

ALTER TABLE `JobLocation`
  ADD COLUMN `locationType` VARCHAR(191) NULL,
  ADD COLUMN `internalNote` TEXT NULL,
  ADD COLUMN `accessInstruction` TEXT NULL,
  ADD COLUMN `latitude` DOUBLE NULL,
  ADD COLUMN `longitude` DOUBLE NULL,
  ADD COLUMN `isPrimary` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `tags` JSON NULL;
