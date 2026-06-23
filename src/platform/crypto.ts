export const Crypto = {
  /**
   * Generates a hash digest of the given string data using the Web Crypto API.
   * Matches the API surface of expo-crypto.
   */
  async digestStringAsync(
    algorithm: 'SHA-256' | 'SHA-512' | 'SHA-1' | 'MD5' | 'SHA-384',
    data: string
  ): Promise<string> {
    const algoMap: Record<string, string> = {
      'SHA-1': 'SHA-1',
      'SHA-256': 'SHA-256',
      'SHA-384': 'SHA-384',
      'SHA-512': 'SHA-512',
    };

    const webAlgo = algoMap[algorithm];
    if (!webAlgo) {
      // Note: Web Crypto doesn't support MD5 natively.
      // We could add a JS polyfill here if providers actually use it.
      throw new Error(`Algorithm ${algorithm} is not supported by Web Crypto API`);
    }

    const encoder = new TextEncoder();
    const dataBuf = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest(webAlgo, dataBuf);
    
    // Convert ArrayBuffer to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    return hashHex;
  },

  /**
   * Generates a random UUID v4 using the Web Crypto API.
   * Matches the API surface of expo-crypto.
   */
  randomUUID(): string {
    return crypto.randomUUID();
  }
};
