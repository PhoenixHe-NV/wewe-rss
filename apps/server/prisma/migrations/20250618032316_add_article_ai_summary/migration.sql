-- CreateTable
CREATE TABLE "article_ai_summaries" (
    "id" TEXT NOT NULL,
    "article_id" VARCHAR(255) NOT NULL,
    "summary" TEXT NOT NULL,
    "keywords" VARCHAR(1024),
    "sentiment" VARCHAR(255),
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "article_ai_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "article_ai_summaries_article_id_key" ON "article_ai_summaries"("article_id");

-- CreateIndex
CREATE INDEX "article_ai_summaries_article_id_idx" ON "article_ai_summaries"("article_id");

-- AddForeignKey
ALTER TABLE "article_ai_summaries" ADD CONSTRAINT "article_ai_summaries_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
