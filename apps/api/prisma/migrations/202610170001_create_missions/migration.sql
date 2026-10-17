CREATE TYPE "MissionStatus" AS ENUM ('DRAFT', 'RUNNING', 'STOPPED', 'COMPLETED');

CREATE TABLE "Mission" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "status" "MissionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settings" JSONB NOT NULL,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);
