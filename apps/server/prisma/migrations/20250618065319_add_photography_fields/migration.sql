-- AlterTable
ALTER TABLE "article_ai_summaries" ADD COLUMN     "activity_keywords" VARCHAR(1024),
ADD COLUMN     "activity_time" VARCHAR(255),
ADD COLUMN     "location" VARCHAR(1024),
ADD COLUMN     "location_city" VARCHAR(255),
ADD COLUMN     "organizer" VARCHAR(1024),
ADD COLUMN     "photography_keywords" VARCHAR(1024);
