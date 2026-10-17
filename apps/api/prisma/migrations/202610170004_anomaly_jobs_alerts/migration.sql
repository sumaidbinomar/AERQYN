CREATE TABLE "AnomalyJob" (
  "id" UUID NOT NULL PRIMARY KEY,
  "missionId" UUID NOT NULL REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "nextPublishAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMPTZ(3), "outcome" VARCHAR(20), "notifiedAt" TIMESTAMPTZ(3)
);
CREATE INDEX "AnomalyJob_processedAt_nextPublishAt_idx" ON "AnomalyJob"("processedAt", "nextPublishAt");
CREATE TABLE "Alert" (
  "id" UUID NOT NULL PRIMARY KEY,
  "jobId" UUID NOT NULL REFERENCES "AnomalyJob"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "missionId" UUID NOT NULL REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "startedAt" TIMESTAMPTZ(3) NOT NULL,
  "droneId" VARCHAR(20) NOT NULL, "type" VARCHAR(30) NOT NULL,
  "message" VARCHAR(200) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "Alert_jobId_droneId_type_key" ON "Alert"("jobId", "droneId", "type");
CREATE INDEX "Alert_missionId_createdAt_id_idx" ON "Alert"("missionId", "createdAt", "id");
