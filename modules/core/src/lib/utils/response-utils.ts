// loaders.gl
// SPDX-License-Identifier: MIT
// Copyright (c) vis.gl contributors

import {isResponse} from '../../javascript-utils/is-type';
import {FetchError} from '../fetch/fetch-error';
import {getResourceContentLength, getResourceUrl, getResourceMIMEType} from './resource-utils';
import {shortenUrlForDisplay} from './url-utils';

/**
 * Returns a Response object
 * Adds content-length header when possible
 *
 * @param resource
 */
export async function makeResponse(resource: unknown): Promise<Response> {
  if (isResponse(resource)) {
    return resource as Response;
  }

  // Add content-length header if possible
  const headers: {[header: string]: string} = {};

  const contentLength = getResourceContentLength(resource);
  if (contentLength >= 0) {
    headers['content-length'] = String(contentLength);
  }

  // `new Response(File)` does not preserve content-type and URL
  // so we add them here
  const url = getResourceUrl(resource);
  const type = getResourceMIMEType(resource);
  if (type) {
    headers['content-type'] = type;
  }

  // Add a custom header with initial bytes if available
  const initialDataUrl = await getInitialDataUrl(resource);
  if (initialDataUrl) {
    headers['x-first-bytes'] = initialDataUrl;
  }

  // TODO - is this the best way of handling strings?
  // Maybe package as data URL instead?
  if (typeof resource === 'string') {
    // Convert to ArrayBuffer to avoid Response treating it as a URL
    resource = new TextEncoder().encode(resource);
  }

  // Attempt to create a Response from the resource, adding headers and setting url
  const response = new Response(resource as any, {headers});
  // We can't control `Response.url` via constructor, use a property override to record URL.
  Object.defineProperty(response, 'url', {value: url});
  return response;
}

/**
 * Checks response status (async) and throws a helpful error message if status is not OK.
 * @param response
 */
export async function checkResponse(response: Response): Promise<void> {
  if (!response.ok) {
    const error = await getResponseError(response);
    throw error;
  }
}

/**
 * Checks response status (sync) and throws a helpful error message if status is not OK.
 * @param response
 */
export function checkResponseSync(response: Response): void {
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    message = message.length > 60 ? `${message.slice(0, 60)}...` : message;
    throw new Error(message);
  }
}

// HELPERS

async function getResponseError(response: Response): Promise<Error> {
  const shortUrl = shortenUrlForDisplay(response.url);
  let message = `Failed to fetch resource (${response.status}) ${response.statusText}: ${shortUrl}`;
  message = message.length > 100 ? `${message.slice(0, 100)}...` : message;

  const info = {
    reason: response.statusText,
    url: response.url,
    response
  };

  try {
    const contentType = response.headers.get('Content-Type');
    info.reason = contentType?.includes('application/json')
      ? await response.json()
      : response.text();
  } catch (error) {
    // eslint forbids return in a finally statement, so we just catch here
  }
  return new FetchError(message, info);
}

async function getInitialDataUrl(
  resource: string | Blob | ArrayBuffer | unknown
): Promise<string | null> {
  const INITIAL_DATA_LENGTH = 5;
  if (typeof resource === 'string') {
    return `data:,${resource.slice(0, INITIAL_DATA_LENGTH)}`;
  }
  if (resource instanceof Blob) {
    const blobSlice = resource.slice(0, 5);
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (event) => resolve(event?.target?.result as string);
      reader.readAsDataURL(blobSlice);
    });
  }
  if (resource instanceof ArrayBuffer) {
    const slice = resource.slice(0, INITIAL_DATA_LENGTH);
    const base64 = arrayBufferToBase64(slice);
    return `data:base64,${base64}`;
  }
  return null;
}

// https://stackoverflow.com/questions/9267899/arraybuffer-to-base64-encoded-string
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
