-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "stripe_customer_id" TEXT,
    "subscription_tier" TEXT,
    "subscription_status" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "businesses" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "business_type" TEXT,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "businesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "licenses" (
    "id" TEXT NOT NULL,
    "business_id" TEXT NOT NULL,
    "license_type" TEXT NOT NULL,
    "license_number" TEXT,
    "issuing_authority" TEXT NOT NULL,
    "issue_date" TIMESTAMP(3) NOT NULL,
    "expiration_date" TIMESTAMP(3) NOT NULL,
    "renewal_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'current',
    "grace_period_days" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "license_id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_url" TEXT NOT NULL,
    "file_type" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_schedules" (
    "id" TEXT NOT NULL,
    "license_id" TEXT NOT NULL,
    "days_before_expiration" INTEGER NOT NULL,
    "reminder_type" TEXT NOT NULL,
    "sent_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reminder_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "runDate" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renewal_history" (
    "id" TEXT NOT NULL,
    "license_id" TEXT NOT NULL,
    "renewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "previous_expiration_date" TIMESTAMP(3) NOT NULL,
    "new_expiration_date" TIMESTAMP(3) NOT NULL,
    "renewed_by" TEXT NOT NULL,
    "notes" TEXT,

    CONSTRAINT "renewal_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jurisdictions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "license_types" TEXT,
    "renewal_portal_urls" TEXT,
    "typical_requirements" TEXT,
    "grace_periods" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jurisdictions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "businesses_user_id_idx" ON "businesses"("user_id");

-- CreateIndex
CREATE INDEX "licenses_business_id_idx" ON "licenses"("business_id");

-- CreateIndex
CREATE INDEX "licenses_expiration_date_idx" ON "licenses"("expiration_date");

-- CreateIndex
CREATE INDEX "documents_license_id_idx" ON "documents"("license_id");

-- CreateIndex
CREATE INDEX "reminder_schedules_license_id_idx" ON "reminder_schedules"("license_id");

-- CreateIndex
CREATE INDEX "reminder_schedules_sent_at_idx" ON "reminder_schedules"("sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "reminder_schedules_license_id_days_before_expiration_remind_key" ON "reminder_schedules"("license_id", "days_before_expiration", "reminder_type");

-- CreateIndex
CREATE UNIQUE INDEX "job_runs_jobName_runDate_key" ON "job_runs"("jobName", "runDate");

-- CreateIndex
CREATE INDEX "renewal_history_license_id_idx" ON "renewal_history"("license_id");

-- AddForeignKey
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_business_id_fkey" FOREIGN KEY ("business_id") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminder_schedules" ADD CONSTRAINT "reminder_schedules_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_history" ADD CONSTRAINT "renewal_history_license_id_fkey" FOREIGN KEY ("license_id") REFERENCES "licenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "renewal_history" ADD CONSTRAINT "renewal_history_renewed_by_fkey" FOREIGN KEY ("renewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
