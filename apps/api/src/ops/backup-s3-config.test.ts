/**
 * Phase 17.2 — Unit tests cho `backup-s3-config.ts`.
 *
 * Pure logic, không boot Nest, không kết nối DB.
 *
 * Coverage:
 *  - parseBackupS3Config: required missing, invalid SSE, invalid DB name,
 *    invalid retention, defaults, force-path-style truthy/falsy, prefix
 *    normalization, region default.
 *  - s3Uri build + trim leading slash.
 *  - awsCliCommonArgs, awsCliSseArgs (sse null vs AES256 vs aws:kms).
 *  - maskSecret short/long.
 */
import { describe, expect, it } from 'vitest';
import {
  REQUIRED_S3_KEYS,
  awsCliCommonArgs,
  awsCliSseArgs,
  maskSecret,
  parseBackupS3Config,
  s3Uri,
} from './backup-s3-config';

function baseEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    BACKUP_S3_ENDPOINT: 'https://s3.example.com',
    BACKUP_S3_BUCKET: 'xuantoi-prod',
    BACKUP_S3_ACCESS_KEY_ID: 'AKIA0000EXAMPLE',
    BACKUP_S3_SECRET_ACCESS_KEY: 'secretexample0123456789abcdef',
    ...extra,
  };
}

describe('REQUIRED_S3_KEYS', () => {
  it('lock-in: exact 4 required keys, immutable order', () => {
    expect(REQUIRED_S3_KEYS).toEqual([
      'BACKUP_S3_ENDPOINT',
      'BACKUP_S3_BUCKET',
      'BACKUP_S3_ACCESS_KEY_ID',
      'BACKUP_S3_SECRET_ACCESS_KEY',
    ]);
  });
});

describe('parseBackupS3Config — required', () => {
  it('reports all 4 missing when env empty', () => {
    const res = parseBackupS3Config({});
    expect(res.ok).toBe(false);
    expect(res.missing.sort()).toEqual([...REQUIRED_S3_KEYS].sort());
  });

  it('reports single missing when only bucket trống', () => {
    const env = baseEnv({ BACKUP_S3_BUCKET: '' });
    const res = parseBackupS3Config(env);
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(['BACKUP_S3_BUCKET']);
  });

  it('trims whitespace — required key all spaces still missing', () => {
    const env = baseEnv({ BACKUP_S3_ENDPOINT: '   ' });
    const res = parseBackupS3Config(env);
    expect(res.ok).toBe(false);
    expect(res.missing).toEqual(['BACKUP_S3_ENDPOINT']);
  });
});

describe('parseBackupS3Config — defaults', () => {
  it('region default us-east-1 when not set', () => {
    const res = parseBackupS3Config(baseEnv());
    expect(res.ok).toBe(true);
    expect(res.config!.region).toBe('us-east-1');
  });

  it('prefix default xuantoi/backups/ when not set', () => {
    const res = parseBackupS3Config(baseEnv());
    expect(res.config!.prefix).toBe('xuantoi/backups/');
  });

  it('prefix appends trailing slash if missing', () => {
    const res = parseBackupS3Config(baseEnv({ BACKUP_S3_PREFIX: 'prod/backups' }));
    expect(res.config!.prefix).toBe('prod/backups/');
  });

  it('prefix preserves trailing slash if present', () => {
    const res = parseBackupS3Config(baseEnv({ BACKUP_S3_PREFIX: 'prod/backups/' }));
    expect(res.config!.prefix).toBe('prod/backups/');
  });

  it('forcePathStyle default true (MinIO/R2 friendly)', () => {
    const res = parseBackupS3Config(baseEnv());
    expect(res.config!.forcePathStyle).toBe(true);
  });

  it('forcePathStyle parses 0/false/no as false', () => {
    for (const v of ['0', 'false', 'FALSE', 'no', 'off']) {
      const res = parseBackupS3Config(baseEnv({ BACKUP_S3_FORCE_PATH_STYLE: v }));
      expect(res.config!.forcePathStyle, `for value=${v}`).toBe(false);
    }
  });

  it('forcePathStyle parses 1/true/yes as true', () => {
    for (const v of ['1', 'true', 'TRUE', 'yes', 'on']) {
      const res = parseBackupS3Config(baseEnv({ BACKUP_S3_FORCE_PATH_STYLE: v }));
      expect(res.config!.forcePathStyle, `for value=${v}`).toBe(true);
    }
  });

  it('verifyTmpDb default xuantoi_verify', () => {
    const res = parseBackupS3Config(baseEnv());
    expect(res.config!.verifyTmpDb).toBe('xuantoi_verify');
  });

  it('verifyTmpRetain default false', () => {
    const res = parseBackupS3Config(baseEnv());
    expect(res.config!.verifyTmpRetain).toBe(false);
  });

  it('retentionDays default 0 when not set', () => {
    const res = parseBackupS3Config(baseEnv());
    expect(res.config!.retentionDays).toBe(0);
  });
});

describe('parseBackupS3Config — invalid', () => {
  it('reports invalid SSE value', () => {
    const res = parseBackupS3Config(baseEnv({ BACKUP_S3_SSE: 'unknown' }));
    expect(res.ok).toBe(false);
    expect(res.invalid).toContain('BACKUP_S3_SSE');
  });

  it('accepts SSE=AES256 case-insensitive', () => {
    const res = parseBackupS3Config(baseEnv({ BACKUP_S3_SSE: 'aes256' }));
    expect(res.ok).toBe(true);
    expect(res.config!.sse).toBe('AES256');
  });

  it('accepts SSE=aws:kms case-insensitive', () => {
    const res = parseBackupS3Config(baseEnv({ BACKUP_S3_SSE: 'AWS:KMS' }));
    expect(res.ok).toBe(true);
    expect(res.config!.sse).toBe('aws:kms');
  });

  it('rejects verifyTmpDb with SQL-injectable chars', () => {
    const res = parseBackupS3Config(
      baseEnv({ BACKUP_VERIFY_TMP_DB: 'mydb; DROP TABLE users--' }),
    );
    expect(res.ok).toBe(false);
    expect(res.invalid).toContain('BACKUP_VERIFY_TMP_DB');
  });

  it('rejects verifyTmpDb starting with digit', () => {
    const res = parseBackupS3Config(baseEnv({ BACKUP_VERIFY_TMP_DB: '1foo' }));
    expect(res.ok).toBe(false);
    expect(res.invalid).toContain('BACKUP_VERIFY_TMP_DB');
  });

  it('accepts verifyTmpDb with underscore + alnum', () => {
    const res = parseBackupS3Config(
      baseEnv({ BACKUP_VERIFY_TMP_DB: 'my_verify_99' }),
    );
    expect(res.ok).toBe(true);
    expect(res.config!.verifyTmpDb).toBe('my_verify_99');
  });

  it('reports invalid retention when non-numeric', () => {
    const res = parseBackupS3Config(baseEnv({ BACKUP_RETENTION_DAYS: 'abc' }));
    expect(res.ok).toBe(false);
    expect(res.invalid).toContain('BACKUP_RETENTION_DAYS');
  });

  it('reports invalid retention when negative', () => {
    const res = parseBackupS3Config(baseEnv({ BACKUP_RETENTION_DAYS: '-3' }));
    expect(res.ok).toBe(false);
    expect(res.invalid).toContain('BACKUP_RETENTION_DAYS');
  });

  it('accepts retention=14', () => {
    const res = parseBackupS3Config(baseEnv({ BACKUP_RETENTION_DAYS: '14' }));
    expect(res.ok).toBe(true);
    expect(res.config!.retentionDays).toBe(14);
  });
});

describe('s3Uri', () => {
  it('builds s3://bucket/prefix/key with default prefix', () => {
    const res = parseBackupS3Config(baseEnv());
    expect(s3Uri(res.config!, 'xuantoi-20260513-150000.sql.gz')).toBe(
      's3://xuantoi-prod/xuantoi/backups/xuantoi-20260513-150000.sql.gz',
    );
  });

  it('strips leading slashes from key', () => {
    const res = parseBackupS3Config(baseEnv());
    expect(s3Uri(res.config!, '//foo.sql.gz')).toBe(
      's3://xuantoi-prod/xuantoi/backups/foo.sql.gz',
    );
  });
});

describe('awsCliCommonArgs', () => {
  it('always emits region + endpoint-url', () => {
    const res = parseBackupS3Config(baseEnv());
    expect(awsCliCommonArgs(res.config!)).toEqual([
      '--region',
      'us-east-1',
      '--endpoint-url',
      'https://s3.example.com',
    ]);
  });
});

describe('awsCliSseArgs', () => {
  it('empty when sse null', () => {
    const res = parseBackupS3Config(baseEnv());
    expect(awsCliSseArgs(res.config!)).toEqual([]);
  });

  it('--sse AES256 when sse=AES256', () => {
    const res = parseBackupS3Config(baseEnv({ BACKUP_S3_SSE: 'AES256' }));
    expect(awsCliSseArgs(res.config!)).toEqual(['--sse', 'AES256']);
  });

  it('--sse aws:kms when sse=aws:kms', () => {
    const res = parseBackupS3Config(baseEnv({ BACKUP_S3_SSE: 'aws:kms' }));
    expect(awsCliSseArgs(res.config!)).toEqual(['--sse', 'aws:kms']);
  });
});

describe('maskSecret', () => {
  it('masks long secret keeping 4 head + 2 tail', () => {
    const m = maskSecret('secretexample0123456789abcdef');
    expect(m.startsWith('secr')).toBe(true);
    expect(m.endsWith('ef')).toBe(true);
    expect(m).not.toContain('example');
  });

  it('all-stars for short secret', () => {
    expect(maskSecret('abc')).toBe('***');
    expect(maskSecret('')).toBe('');
  });
});
