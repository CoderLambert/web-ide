export const SQL_LAB_LIMITS = {
  maxSqlBytes: 1024 * 1024,
  maxStatements: 50,
  maxRowsPerResult: 1000,
  maxTotalRows: 5000,
  maxTextCellBytes: 64 * 1024,
  maxResultBytes: 4 * 1024 * 1024,
  maxDatabaseBytes: 64 * 1024 * 1024,
  executionTimeoutMs: 5000,
  terminationGraceMs: 1000,
} as const;
