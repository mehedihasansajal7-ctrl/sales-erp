# =============================================================================
# Backup encryption helpers (dot-sourced by backup-docker.ps1, restore-drill.ps1
# and decrypt-backup.ps1).
#
# A dump is encrypted with AES-256-CBC and authenticated with HMAC-SHA256
# (encrypt-then-MAC). The key is derived with PBKDF2-SHA256 (100 000 iterations)
# from a random password stored in a key file that lives OUTSIDE the backup
# folders - if the key travelled with the dump the encryption would be pointless.
#
# File layout:  "SERPBAK1" (8) | salt (16) | iv (16) | hmac (32) | ciphertext
# =============================================================================

$script:BackupMagic = [System.Text.Encoding]::ASCII.GetBytes("SERPBAK1")
$script:KeyIterations = 100000

function New-BackupKeyFile {
    param([string]$KeyFile)

    $directory = Split-Path -Parent $KeyFile
    if ($directory -and -not (Test-Path $directory)) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }

    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 48
    $rng.GetBytes($bytes)
    $rng.Dispose()

    $key = [Convert]::ToBase64String($bytes)
    [System.IO.File]::WriteAllText($KeyFile, $key, (New-Object System.Text.UTF8Encoding($false)))
    return $key
}

function Get-BackupKey {
    param([string]$KeyFile)

    if (-not (Test-Path $KeyFile)) {
        $key = New-BackupKeyFile -KeyFile $KeyFile
        return @{ Key = $key; Created = $true }
    }

    $key = (Get-Content -Path $KeyFile -Raw).Trim()
    if ($key.Length -lt 32) { throw "Backup key file $KeyFile looks truncated." }
    return @{ Key = $key; Created = $false }
}

function Get-DerivedKey {
    param([string]$Password, [byte[]]$Salt)
    $derive = New-Object System.Security.Cryptography.Rfc2898DeriveBytes(
        $Password,
        $Salt,
        $script:KeyIterations,
        [System.Security.Cryptography.HashAlgorithmName]::SHA256
    )
    try {
        return $derive.GetBytes(32)
    } finally {
        $derive.Dispose()
    }
}

function Protect-BackupFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$OutPath,
        [Parameter(Mandatory)][string]$Password
    )

    $plain = [System.IO.File]::ReadAllBytes($Path)

    $salt = New-Object byte[] 16
    $iv = New-Object byte[] 16
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($salt)
    $rng.GetBytes($iv)
    $rng.Dispose()

    $key = Get-DerivedKey -Password $Password -Salt $salt

    $aes = [System.Security.Cryptography.Aes]::Create()
    try {
        $aes.Key = $key
        $aes.IV = $iv
        $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
        $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
        $encryptor = $aes.CreateEncryptor()
        try {
            $cipher = $encryptor.TransformFinalBlock($plain, 0, $plain.Length)
        } finally {
            $encryptor.Dispose()
        }
    } finally {
        $aes.Dispose()
    }

    $macInput = New-Object byte[] ($salt.Length + $iv.Length + $cipher.Length)
    [Array]::Copy($salt, 0, $macInput, 0, $salt.Length)
    [Array]::Copy($iv, 0, $macInput, $salt.Length, $iv.Length)
    [Array]::Copy($cipher, 0, $macInput, $salt.Length + $iv.Length, $cipher.Length)

    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    try {
        $hmac.Key = $key
        $mac = $hmac.ComputeHash($macInput)
    } finally {
        $hmac.Dispose()
    }

    $out = New-Object System.IO.MemoryStream
    $out.Write($script:BackupMagic, 0, $script:BackupMagic.Length)
    $out.Write($salt, 0, $salt.Length)
    $out.Write($iv, 0, $iv.Length)
    $out.Write($mac, 0, $mac.Length)
    $out.Write($cipher, 0, $cipher.Length)

    [System.IO.File]::WriteAllBytes($OutPath, $out.ToArray())
    $out.Dispose()

    return $OutPath
}

function Unprotect-BackupFile {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$OutPath,
        [Parameter(Mandatory)][string]$Password
    )

    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $magicLength = $script:BackupMagic.Length

    if ($bytes.Length -lt ($magicLength + 16 + 16 + 32 + 16)) {
        throw "$Path is too short to be a backup file."
    }
    for ($i = 0; $i -lt $magicLength; $i++) {
        if ($bytes[$i] -ne $script:BackupMagic[$i]) { throw "$Path is not an encrypted ERP backup." }
    }

    $offset = $magicLength
    $salt = New-Object byte[] 16
    $iv = New-Object byte[] 16
    $mac = New-Object byte[] 32
    [Array]::Copy($bytes, $offset, $salt, 0, 16); $offset += 16
    [Array]::Copy($bytes, $offset, $iv, 0, 16); $offset += 16
    [Array]::Copy($bytes, $offset, $mac, 0, 32); $offset += 32
    $cipher = New-Object byte[] ($bytes.Length - $offset)
    [Array]::Copy($bytes, $offset, $cipher, 0, $cipher.Length)

    $key = Get-DerivedKey -Password $Password -Salt $salt

    $macInput = New-Object byte[] ($salt.Length + $iv.Length + $cipher.Length)
    [Array]::Copy($salt, 0, $macInput, 0, $salt.Length)
    [Array]::Copy($iv, 0, $macInput, $salt.Length, $iv.Length)
    [Array]::Copy($cipher, 0, $macInput, $salt.Length + $iv.Length, $cipher.Length)

    $hmac = New-Object System.Security.Cryptography.HMACSHA256
    try {
        $hmac.Key = $key
        $expected = $hmac.ComputeHash($macInput)
    } finally {
        $hmac.Dispose()
    }

    # Constant-time-ish comparison: any difference means tampering or a wrong key.
    $diff = 0
    for ($i = 0; $i -lt $mac.Length; $i++) { $diff = $diff -bor ($mac[$i] -bxor $expected[$i]) }
    if ($diff -ne 0) { throw "Backup authentication failed - wrong key or the file was modified." }

    $aes = [System.Security.Cryptography.Aes]::Create()
    try {
        $aes.Key = $key
        $aes.IV = $iv
        $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
        $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
        $decryptor = $aes.CreateDecryptor()
        try {
            $plain = $decryptor.TransformFinalBlock($cipher, 0, $cipher.Length)
        } finally {
            $decryptor.Dispose()
        }
    } finally {
        $aes.Dispose()
    }

    [System.IO.File]::WriteAllBytes($OutPath, $plain)
    return $OutPath
}
