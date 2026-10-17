CREATE TABLE "TelemetrySnapshot" (
 "missionId" UUID NOT NULL REFERENCES "Mission"("id") ON DELETE CASCADE,
 "startedAt" TIMESTAMPTZ(3) NOT NULL,
 "elapsedMs" INTEGER NOT NULL,
 "frame" JSONB NOT NULL,
 PRIMARY KEY ("missionId", "startedAt", "elapsedMs")
);
