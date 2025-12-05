/*
  Warnings:

  - You are about to alter the column `deletedAt` on the `Employee` table. The data in that column could be lost. The data in that column will be cast from `DateTime(0)` to `DateTime`.
  - You are about to alter the column `deletedAt` on the `Job` table. The data in that column could be lost. The data in that column will be cast from `DateTime(0)` to `DateTime`.

*/
-- AlterTable
ALTER TABLE `Employee` MODIFY `deletedAt` DATETIME NULL;

-- AlterTable
ALTER TABLE `Job` MODIFY `deletedAt` DATETIME NULL;
