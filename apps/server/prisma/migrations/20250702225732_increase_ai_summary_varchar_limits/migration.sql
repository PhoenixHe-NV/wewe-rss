-- DropForeignKey
ALTER TABLE "article_ai_summaries" DROP CONSTRAINT "article_ai_summaries_article_id_fkey";

-- AlterTable
ALTER TABLE "article_ai_summaries" ALTER COLUMN "article_id" SET DATA TYPE VARCHAR(1024),
ALTER COLUMN "sentiment" SET DATA TYPE VARCHAR(1024),
ALTER COLUMN "activity_time" SET DATA TYPE VARCHAR(1024),
ALTER COLUMN "location_city" SET DATA TYPE VARCHAR(1024);

-- AddForeignKey
ALTER TABLE "article_ai_summaries" ADD CONSTRAINT "article_ai_summaries_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
