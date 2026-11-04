// Certificate upload rules: type, size, magic number and the object path.
import { describe, expect, it } from 'vitest'

import {
  ALLOWED_ATTACHMENT_TYPES,
  ATTACHMENT_MESSAGES,
  CERTIFICATE_BUCKET,
  MAX_ATTACHMENT_BYTES,
  SIGNED_URL_EXPIRES_IN,
  attachmentPath,
  extensionFor,
  isCertificatePath,
  matchesSignature,
  normalizeContentType,
  safeAttachmentName,
  validateAttachment,
} from '../worker/src/leave-attachment.js'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00])
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37])
const EMPLOYEE_ID = '11111111-1111-4111-8111-111111111111'
const CODE = 'LV-20261103-001'

describe('content type', () => {
  it('accepts jpeg, png and pdf, including parameters and aliases', () => {
    expect(normalizeContentType('image/jpeg')).toBe('image/jpeg')
    expect(normalizeContentType('image/jpg')).toBe('image/jpeg')
    expect(normalizeContentType('image/png; charset=binary')).toBe('image/png')
    expect(normalizeContentType('APPLICATION/PDF')).toBe('application/pdf')
    expect(ALLOWED_ATTACHMENT_TYPES).toEqual(['image/jpeg', 'image/png', 'application/pdf'])
  })

  it('refuses anything else', () => {
    expect(normalizeContentType('application/octet-stream')).toBe(null)
    expect(normalizeContentType('application/zip')).toBe(null)
    expect(normalizeContentType('image/gif')).toBe(null)
    expect(normalizeContentType('')).toBe(null)
    expect(normalizeContentType(null)).toBe(null)
  })
})

describe('validateAttachment', () => {
  it('rejects an unsupported type before looking at the bytes', () => {
    expect(validateAttachment({ contentType: 'application/zip', size: 10 })).toEqual({
      ok: false,
      message: ATTACHMENT_MESSAGES.typeInvalid,
    })
  })

  it('rejects an empty and an oversized file', () => {
    expect(validateAttachment({ contentType: 'image/png', size: 0 }).message).toBe(
      ATTACHMENT_MESSAGES.empty
    )
    expect(
      validateAttachment({ contentType: 'image/png', size: MAX_ATTACHMENT_BYTES + 1 }).message
    ).toBe(ATTACHMENT_MESSAGES.sizeTooLarge)
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024)
  })

  it('accepts exactly 10 MB', () => {
    expect(validateAttachment({ contentType: 'application/pdf', size: MAX_ATTACHMENT_BYTES }).ok).toBe(
      true
    )
  })

  it('rejects content that does not match the declared type', () => {
    expect(
      validateAttachment({ contentType: 'application/pdf', size: PDF.length, bytes: PNG }).message
    ).toBe(ATTACHMENT_MESSAGES.contentMismatch)

    expect(validateAttachment({ contentType: 'image/png', size: PNG.length, bytes: PNG }).ok).toBe(
      true
    )
    expect(validateAttachment({ contentType: 'image/jpeg', size: JPEG.length, bytes: JPEG }).ok).toBe(
      true
    )
    expect(validateAttachment({ contentType: 'application/pdf', size: PDF.length, bytes: PDF }).ok).toBe(
      true
    )
  })

  it('checks each signature', () => {
    expect(matchesSignature(PNG, 'image/png')).toBe(true)
    expect(matchesSignature(JPEG, 'image/jpeg')).toBe(true)
    expect(matchesSignature(PDF, 'application/pdf')).toBe(true)
    expect(matchesSignature(PDF, 'image/png')).toBe(false)
    expect(matchesSignature(new Uint8Array([1, 2]), 'image/png')).toBe(false)
  })
})

describe('object names and paths', () => {
  it('makes a safe ASCII name with the extension from the type', () => {
    expect(safeAttachmentName('scan.png', 'image/png')).toBe('scan.png')
    expect(safeAttachmentName('ใบรับรองแพทย์ ๑.pdf', 'application/pdf')).toBe('certificate.pdf')
    expect(safeAttachmentName('../../etc/passwd', 'application/pdf')).toBe('passwd.pdf')
    expect(safeAttachmentName('photo.JPG', 'image/jpeg')).toBe('photo.jpg')
    expect(safeAttachmentName('', 'image/jpeg')).toBe('certificate.jpg')
    expect(extensionFor('image/png')).toBe('png')
  })

  it('builds leave/<employee>/<code>/<file>', () => {
    const path = attachmentPath({
      employeeId: EMPLOYEE_ID,
      requestCode: CODE,
      fileName: 'scan.png',
    })
    expect(path).toBe(`leave/${EMPLOYEE_ID}/${CODE}/scan.png`)
    expect(isCertificatePath(path)).toBe(true)
  })

  it('refuses parts that could escape the prefix', () => {
    expect(attachmentPath({ employeeId: 'a/b', requestCode: CODE, fileName: 'x.png' })).toBe(null)
    expect(attachmentPath({ employeeId: EMPLOYEE_ID, requestCode: 'LV 1', fileName: 'x.png' })).toBe(
      null
    )
    expect(attachmentPath({ employeeId: EMPLOYEE_ID, requestCode: CODE, fileName: '..' })).toBe(null)
    expect(attachmentPath({})).toBe(null)
  })

  it('recognises only its own object paths', () => {
    expect(isCertificatePath(`leave/${EMPLOYEE_ID}/${CODE}/scan.png`)).toBe(true)
    expect(isCertificatePath('https://example.test/cert.pdf')).toBe(false)
    expect(isCertificatePath('other/x/y.png')).toBe(false)
    expect(isCertificatePath(`leave/${EMPLOYEE_ID}/${CODE}`)).toBe(false)
    expect(isCertificatePath(`leave/${EMPLOYEE_ID}/${CODE}/a/../b.png`)).toBe(false)
    expect(isCertificatePath(null)).toBe(false)
  })

  it('uses the private bucket and a 60-second signed URL', () => {
    expect(CERTIFICATE_BUCKET).toBe('leave-certificates')
    expect(SIGNED_URL_EXPIRES_IN).toBe(60)
  })
})
