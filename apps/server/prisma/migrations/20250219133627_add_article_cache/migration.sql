-- CreateTable
CREATE TABLE "article_caches" (
    "id" TEXT NOT NULL,
    "article_id" VARCHAR(255) NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "article_caches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "article_caches_article_id_key" ON "article_caches"("article_id");

-- CreateIndex
CREATE INDEX "article_caches_article_id_idx" ON "article_caches"("article_id");

-- CreateIndex
CREATE INDEX "articles_mp_id_idx" ON "articles"("mp_id");

-- AddForeignKey
ALTER TABLE "article_caches" ADD CONSTRAINT "article_caches_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
