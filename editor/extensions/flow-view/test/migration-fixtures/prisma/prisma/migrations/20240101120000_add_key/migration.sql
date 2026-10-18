-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "customer_email" VARCHAR(120) NOT NULL,
    "status" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "key" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "orders_key_key" ON "orders"("key");
