import QRCode from 'qrcode'

/**
 * Renders a ticket's code as a scannable QR PNG, returned as a data URL so
 * the frontend can drop it straight into an <img src="..."> with no extra request.
 */
export const generateQrCodeDataUrl = (code: string): Promise<string> => {
  return QRCode.toDataURL(code, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
  })
}

/**
 * Same QR code as a PNG buffer — used for email attachments.
 */
export const generateQrCodeBuffer = (code: string): Promise<Buffer> => {
  return QRCode.toBuffer(code, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
  })
}
