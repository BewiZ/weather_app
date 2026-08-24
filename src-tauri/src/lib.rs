use ring::signature::Ed25519KeyPair;
use std::time::SystemTime;

// Ed25519 私钥（PKCS8 DER 编码，base64）
const ED25519_PRIVATE_KEY_B64: &str =
    "MC4CAQAwBQYDK2VwBCIEIIJCaLlBmEXWOq9cA/e0jTGgMQwKanl/IgXvMNY8xJl0";
const CREDENTIAL_ID: &str = "T4PUGFNTPN";
const PROJECT_ID: &str = "3JDXH36AXX";

fn base64_decode(input: &str) -> Vec<u8> {
    const CHARS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut data: Vec<u8> = Vec::new();
    let mut buf: u32 = 0;
    let mut bits: u32 = 0;
    for b in input.bytes() {
        if b == b'=' { break; }
        if b == b'-' || b == b'_' {
            let idx = if b == b'-' { 62 } else { 63 };
            buf = (buf << 6) | idx as u32;
            bits += 6;
            if bits >= 8 {
                bits -= 8;
                data.push(((buf >> bits) & 0xFF) as u8);
            }
        } else {
            if let Some(idx) = CHARS.iter().position(|&c| c == b) {
                buf = (buf << 6) | idx as u32;
                bits += 6;
                if bits >= 8 {
                    bits -= 8;
                    data.push(((buf >> bits) & 0xFF) as u8);
                }
            }
        }
    }
    data
}

fn base64_url_encode(bytes: &[u8]) -> String {
    let mut result = String::new();
    const CHARS: &[u8; 64] =
        b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut i = 0;
    while i < bytes.len() {
        let b0 = bytes[i];
        let b1 = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
        let b2 = if i + 2 < bytes.len() { bytes[i + 2] } else { 0 };
        let n = ((b0 as u32) << 16) | ((b1 as u32) << 8) | (b2 as u32);
        result.push(CHARS[((n >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((n >> 12) & 0x3F) as usize] as char);
        if i + 1 < bytes.len() {
            result.push(CHARS[((n >> 6) & 0x3F) as usize] as char);
        }
        if i + 2 < bytes.len() {
            result.push(CHARS[(n & 0x3F) as usize] as char);
        }
        i += 3;
    }
    result
}

/// 生成 QWeather EdDSA JWT 签名
#[tauri::command]
fn generate_jwt() -> String {
    let iat = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap()
        .as_secs()
        .saturating_sub(30); // 提前 30 秒，防止时间误差
    let exp = iat + 1800;

    let header = serde_json::json!({
        "alg": "EdDSA",
        "kid": CREDENTIAL_ID
    });
    let payload = serde_json::json!({
        "sub": PROJECT_ID,
        "iat": iat,
        "exp": exp
    });

    let header_b64 = base64_url_encode(header.to_string().as_bytes());
    let payload_b64 = base64_url_encode(payload.to_string().as_bytes());
    let signing_input = format!("{}.{}", header_b64, payload_b64);

    let der_bytes = base64_decode(ED25519_PRIVATE_KEY_B64);
    let key_pair =
        Ed25519KeyPair::from_pkcs8_maybe_unchecked(&der_bytes).expect("invalid key");
    let signature = key_pair.sign(signing_input.as_bytes());

    format!("{}.{}", signing_input, base64_url_encode(signature.as_ref()))
}

#[tauri::command]
async fn ping_test() -> Result<String, String> {
    Ok("pong: v3.1 JS-fetch".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![ping_test, generate_jwt])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}