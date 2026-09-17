-- Hora da tentativa atual do webhook (reprocessa eventos presos em PROCESSING).
ALTER TABLE "WebhookEvent" ADD COLUMN "lastAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
