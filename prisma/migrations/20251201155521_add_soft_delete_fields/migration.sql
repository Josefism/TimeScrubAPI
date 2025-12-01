-- AlterTable
ALTER TABLE `Employee` ADD COLUMN `deletedAt` DATETIME NULL,
    ADD COLUMN `deletedBy` INTEGER NULL;

-- AlterTable
ALTER TABLE `Job` ADD COLUMN `deletedAt` DATETIME NULL,
    ADD COLUMN `deletedBy` INTEGER NULL;

-- CreateIndex
CREATE INDEX `Employee_deletedAt_idx` ON `Employee`(`deletedAt`);

-- CreateIndex
CREATE INDEX `Job_deletedAt_idx` ON `Job`(`deletedAt`);

-- AddForeignKey
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_deletedBy_fkey` FOREIGN KEY (`deletedBy`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Job` ADD CONSTRAINT `Job_deletedBy_fkey` FOREIGN KEY (`deletedBy`) REFERENCES `Employee`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
