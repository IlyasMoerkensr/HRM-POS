-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "pinHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'MEDEWERKER',
    "color" TEXT NOT NULL DEFAULT '#2563eb',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mollieTerminalId" TEXT,
    "phoneLabel" TEXT,
    "maxDiscountBp" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LedgerAccount" (
    "code" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "VatRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rateBp" INTEGER NOT NULL,
    "revenueAccountCode" TEXT NOT NULL,
    "vatAccountCode" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "VatRate_revenueAccountCode_fkey" FOREIGN KEY ("revenueAccountCode") REFERENCES "LedgerAccount" ("code") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VatRate_vatAccountCode_fkey" FOREIGN KEY ("vatAccountCode") REFERENCES "LedgerAccount" ("code") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "NumberSequence" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "last" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#64748b',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "sku" TEXT,
    "categoryId" TEXT,
    "priceInclCents" INTEGER NOT NULL,
    "vatRateId" TEXT NOT NULL,
    "openPrice" BOOLEAN NOT NULL DEFAULT false,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Product_vatRateId_fkey" FOREIGN KEY ("vatRateId") REFERENCES "VatRate" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BusinessDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "openingFloatCents" INTEGER NOT NULL,
    "openedById" TEXT NOT NULL,
    "openedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,
    "closedAt" DATETIME,
    CONSTRAINT "BusinessDay_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "BusinessDay_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT,
    "type" TEXT NOT NULL DEFAULT 'SALE',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "businessDayId" TEXT NOT NULL,
    "cashierId" TEXT NOT NULL,
    "parkedLabel" TEXT,
    "note" TEXT,
    "discountType" TEXT,
    "discountValue" INTEGER,
    "subtotalExclCents" INTEGER NOT NULL DEFAULT 0,
    "vatCents" INTEGER NOT NULL DEFAULT 0,
    "totalInclCents" INTEGER NOT NULL DEFAULT 0,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "creditOfOrderId" TEXT,
    "voidReason" TEXT,
    "voidedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "numberedAt" DATETIME,
    "paidAt" DATETIME,
    CONSTRAINT "Order_businessDayId_fkey" FOREIGN KEY ("businessDayId") REFERENCES "BusinessDay" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_cashierId_fkey" FOREIGN KEY ("cashierId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_creditOfOrderId_fkey" FOREIGN KEY ("creditOfOrderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "productId" TEXT,
    "position" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceInclCents" INTEGER NOT NULL,
    "vatCode" TEXT NOT NULL,
    "vatRateBp" INTEGER NOT NULL,
    "revenueAccountCode" TEXT NOT NULL,
    "vatAccountCode" TEXT,
    "lineDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "orderDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "totalInclCents" INTEGER NOT NULL,
    "vatCents" INTEGER NOT NULL,
    "totalExclCents" INTEGER NOT NULL,
    "creditOfLineId" TEXT,
    CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OrderLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OrderLine_creditOfLineId_fkey" FOREIGN KEY ("creditOfLineId") REFERENCES "OrderLine" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OrderVatLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "vatCode" TEXT NOT NULL,
    "vatRateBp" INTEGER NOT NULL,
    "revenueAccountCode" TEXT NOT NULL,
    "vatAccountCode" TEXT,
    "totalInclCents" INTEGER NOT NULL,
    "vatCents" INTEGER NOT NULL,
    "totalExclCents" INTEGER NOT NULL,
    CONSTRAINT "OrderVatLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orderId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "amountCents" INTEGER NOT NULL,
    "employeeId" TEXT NOT NULL,
    "tenderedCents" INTEGER,
    "changeCents" INTEGER,
    "mollieMode" TEXT,
    "molliePaymentId" TEXT,
    "mollieRefundId" TEXT,
    "mollieTerminalId" TEXT,
    "mollieStatus" TEXT,
    "mollieStatusReason" TEXT,
    "cardLast4" TEXT,
    "cardLabel" TEXT,
    "confirmedById" TEXT,
    "confirmedAt" DATETIME,
    "reconciledMolliePaymentId" TEXT,
    "reconciledAt" DATETIME,
    "mollieSettlementId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "paidAt" DATETIME,
    CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Payment_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CashMovement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessDayId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT,
    "orderId" TEXT,
    "paymentId" TEXT,
    "drawerOpened" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashMovement_businessDayId_fkey" FOREIGN KEY ("businessDayId") REFERENCES "BusinessDay" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CashMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CashMovement_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CashMovement_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ZReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT NOT NULL,
    "businessDayId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saleCount" INTEGER NOT NULL,
    "creditCount" INTEGER NOT NULL,
    "voidedCount" INTEGER NOT NULL,
    "noSaleCount" INTEGER NOT NULL,
    "grossRevenueCents" INTEGER NOT NULL,
    "netRevenueCents" INTEGER NOT NULL,
    "vatTotalCents" INTEGER NOT NULL,
    "discountTotalCents" INTEGER NOT NULL,
    "openingFloatCents" INTEGER NOT NULL,
    "cashSalesCents" INTEGER NOT NULL,
    "cashRefundsCents" INTEGER NOT NULL,
    "cashInCents" INTEGER NOT NULL,
    "cashOutCents" INTEGER NOT NULL,
    "expectedCashCents" INTEGER NOT NULL,
    "countedCashCents" INTEGER NOT NULL,
    "cashDifferenceCents" INTEGER NOT NULL,
    "cashCountJson" TEXT NOT NULL,
    "cashDifferenceNote" TEXT,
    "mollieTotalCents" INTEGER NOT NULL,
    "mollieApiTotalCents" INTEGER,
    "mollieDifferenceCents" INTEGER,
    "paymentsTotalCents" INTEGER NOT NULL,
    CONSTRAINT "ZReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ZReport_businessDayId_fkey" FOREIGN KEY ("businessDayId") REFERENCES "BusinessDay" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ZReportVatLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zReportId" TEXT NOT NULL,
    "vatCode" TEXT NOT NULL,
    "vatRateBp" INTEGER NOT NULL,
    "revenueAccountCode" TEXT NOT NULL,
    "vatAccountCode" TEXT,
    "totalInclCents" INTEGER NOT NULL,
    "vatCents" INTEGER NOT NULL,
    "totalExclCents" INTEGER NOT NULL,
    CONSTRAINT "ZReportVatLine_zReportId_fkey" FOREIGN KEY ("zReportId") REFERENCES "ZReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ZReportMollieLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "zReportId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "posCount" INTEGER NOT NULL,
    "posAmountCents" INTEGER NOT NULL,
    "mollieCount" INTEGER,
    "mollieAmountCents" INTEGER,
    "differenceCents" INTEGER,
    "manualCount" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ZReportMollieLine_zReportId_fkey" FOREIGN KEY ("zReportId") REFERENCES "ZReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ZReportMollieLine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MollieReconciliation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "businessDayId" TEXT NOT NULL,
    "runAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "posTotalCents" INTEGER NOT NULL,
    "mollieTotalCents" INTEGER NOT NULL,
    "differenceCents" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,
    "errorMessage" TEXT,
    CONSTRAINT "MollieReconciliation_businessDayId_fkey" FOREIGN KEY ("businessDayId") REFERENCES "BusinessDay" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MollieReconciliationItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reconciliationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "paymentId" TEXT,
    "molliePaymentId" TEXT,
    "mollieRefundId" TEXT,
    "mollieTerminalId" TEXT,
    "userId" TEXT,
    "posAmountCents" INTEGER,
    "mollieAmountCents" INTEGER,
    "mollieCreatedAt" DATETIME,
    "note" TEXT,
    CONSTRAINT "MollieReconciliationItem_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "MollieReconciliation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MollieReconciliationItem_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MollieReconciliationItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MollieSettlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reference" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL,
    "settledAt" DATETIME,
    "amountCents" INTEGER NOT NULL,
    "revenueGrossCents" INTEGER NOT NULL,
    "costsGrossCents" INTEGER NOT NULL,
    "costsNetCents" INTEGER NOT NULL,
    "costsVatCents" INTEGER NOT NULL,
    "invoiceId" TEXT,
    "syncedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "MollieSettlementLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "settlementId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "netCents" INTEGER NOT NULL,
    "vatCents" INTEGER NOT NULL,
    "grossCents" INTEGER NOT NULL,
    CONSTRAINT "MollieSettlementLine_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "MollieSettlement" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "data" TEXT,
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_mollieTerminalId_key" ON "User"("mollieTerminalId");

-- CreateIndex
CREATE UNIQUE INDEX "VatRate_code_key" ON "VatRate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");

-- CreateIndex
CREATE INDEX "Product_categoryId_active_sortOrder_idx" ON "Product"("categoryId", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessDay_date_key" ON "BusinessDay"("date");

-- CreateIndex
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");

-- CreateIndex
CREATE INDEX "Order_businessDayId_status_idx" ON "Order"("businessDayId", "status");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "OrderLine_orderId_idx" ON "OrderLine"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "OrderVatLine_orderId_vatCode_key" ON "OrderVatLine"("orderId", "vatCode");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_molliePaymentId_key" ON "Payment"("molliePaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_mollieRefundId_key" ON "Payment"("mollieRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_orderId_idx" ON "Payment"("orderId");

-- CreateIndex
CREATE INDEX "Payment_method_status_createdAt_idx" ON "Payment"("method", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_employeeId_createdAt_idx" ON "Payment"("employeeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CashMovement_paymentId_key" ON "CashMovement"("paymentId");

-- CreateIndex
CREATE INDEX "CashMovement_businessDayId_type_idx" ON "CashMovement"("businessDayId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ZReport_number_key" ON "ZReport"("number");

-- CreateIndex
CREATE UNIQUE INDEX "ZReport_businessDayId_key" ON "ZReport"("businessDayId");

-- CreateIndex
CREATE UNIQUE INDEX "ZReportVatLine_zReportId_vatCode_key" ON "ZReportVatLine"("zReportId", "vatCode");

-- CreateIndex
CREATE UNIQUE INDEX "ZReportMollieLine_zReportId_userId_key" ON "ZReportMollieLine"("zReportId", "userId");

-- CreateIndex
CREATE INDEX "MollieReconciliation_businessDayId_runAt_idx" ON "MollieReconciliation"("businessDayId", "runAt");

-- CreateIndex
CREATE INDEX "MollieReconciliationItem_reconciliationId_type_idx" ON "MollieReconciliationItem"("reconciliationId", "type");

-- CreateIndex
CREATE INDEX "MollieSettlementLine_settlementId_idx" ON "MollieSettlementLine"("settlementId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");
