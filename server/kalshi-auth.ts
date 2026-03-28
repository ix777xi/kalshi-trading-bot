import crypto from "crypto";

/**
 * Sign a Kalshi API request using RSA-PSS SHA256.
 * The path used for signing must include the full API path prefix.
 * Query parameters are stripped before signing but included in the actual request URL.
 */
export function signRequest(
  privateKeyPem: string,
  timestamp: string,
  method: string,
  path: string
): string {
  // Strip query parameters from path before signing
  const pathWithoutQuery = path.split("?")[0];
  const message = `${timestamp}${method}${pathWithoutQuery}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(message);
  sign.end();

  const signature = sign.sign({
    key: privateKeyPem,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });

  return signature.toString("base64");
}

/**
 * Build the auth headers required for Kalshi authenticated requests.
 * The path provided should be the full path including /trade-api/v2/ prefix.
 */
export function getAuthHeaders(
  apiKeyId: string,
  privateKeyPem: string,
  method: string,
  path: string
): Record<string, string> {
  const timestamp = Date.now().toString();
  const signature = signRequest(privateKeyPem, timestamp, method, path);
  return {
    "KALSHI-ACCESS-KEY": apiKeyId,
    "KALSHI-ACCESS-SIGNATURE": signature,
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
    "Content-Type": "application/json",
  };
}
