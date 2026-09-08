-- CreateTable
CREATE TABLE "toll_roads" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "geometry" JSONB NOT NULL,
    "estimated_fare_gol1" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "verified_at" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "toll_roads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "toll_roads_name_key" ON "toll_roads"("name");
