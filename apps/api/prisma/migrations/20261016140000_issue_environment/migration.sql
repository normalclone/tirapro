-- Môi trường có cấu trúc cho công việc (Bug): {env, browser, os, build, url, viewport}.
ALTER TABLE "Issue" ADD COLUMN "environment" JSONB;
