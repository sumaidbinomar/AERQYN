CREATE TYPE "Role" AS ENUM ('RESEARCHER', 'OBSERVER');

CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
