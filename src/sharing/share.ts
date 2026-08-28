import simplify from '@turf/simplify';
import { deflateSync, inflateSync, strFromU8, strToU8 } from 'fflate';
import type { AreaGeometry, CanonicalWorkspace, WorkspaceShare } from '../domain/schemas';
import { WorkspaceShareSchema } from '../domain/schemas';

export const MAX_SHARE_LENGTH = 8_192;
export const STORAGE_KEY = 'groundwork:workspace:v1';

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function simplifyCanonical(canonical: CanonicalWorkspace): CanonicalWorkspace {
  return {
    ...canonical,
    conditions: canonical.conditions.map((condition) =>
      condition.kind === 'preference'
        ? {
            ...condition,
            geometry: simplify(condition.geometry as AreaGeometry, {
              tolerance: 0.00015,
              highQuality: true,
              mutate: false,
            }) as AreaGeometry,
          }
        : condition,
    ),
  };
}

export function encodeWorkspace(input: WorkspaceShare): string {
  const normalized: WorkspaceShare = {
    ...input,
    canonical: simplifyCanonical(input.canonical),
    undo: input.undo ? simplifyCanonical(input.undo) : null,
    activity: input.activity.slice(-40),
  };
  const validated = WorkspaceShareSchema.parse(normalized);
  const encoded = toBase64Url(deflateSync(strToU8(JSON.stringify(validated)), { level: 9 }));
  if (encoded.length > MAX_SHARE_LENGTH) {
    throw new Error(
      'This workspace is too detailed for a reliable share link. Simplify the drawing and try again.',
    );
  }
  return encoded;
}

export function decodeWorkspace(encoded: string): WorkspaceShare {
  if (!encoded || encoded.length > MAX_SHARE_LENGTH)
    throw new Error('The workspace link is invalid or too large.');
  try {
    const json = strFromU8(inflateSync(fromBase64Url(encoded)));
    return WorkspaceShareSchema.parse(JSON.parse(json));
  } catch {
    throw new Error('The workspace link is invalid or was created by an unsupported version.');
  }
}

export function createShareUrl(input: WorkspaceShare): string {
  const url = new URL(window.location.href);
  url.hash = `w=${encodeWorkspace(input)}`;
  return url.toString();
}

export function readSharedWorkspace(): WorkspaceShare | null {
  const encoded = new URLSearchParams(window.location.hash.slice(1)).get('w');
  return encoded ? decodeWorkspace(encoded) : null;
}

export function saveLocalWorkspace(input: WorkspaceShare): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(WorkspaceShareSchema.parse(input)));
}

export function readLocalWorkspace(): WorkspaceShare | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return WorkspaceShareSchema.parse(JSON.parse(raw));
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export function clearLocalWorkspace(): void {
  localStorage.removeItem(STORAGE_KEY);
}
