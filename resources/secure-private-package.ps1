[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PackageRoot,
    [Parameter(Mandatory)][string]$StateRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-NormalizedPath {
    param([Parameter(Mandatory)][string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $root = [System.IO.Path]::GetPathRoot($fullPath)
    if ([string]::Equals($fullPath, $root, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $root
    }
    return $fullPath.TrimEnd(
        [System.IO.Path]::DirectorySeparatorChar,
        [System.IO.Path]::AltDirectorySeparatorChar
    )
}

function Assert-PathWithinProfile {
    param([Parameter(Mandatory)][string]$Path)

    $profileRoot = Get-NormalizedPath ([Environment]::GetFolderPath(
        [Environment+SpecialFolder]::UserProfile
    ))
    $candidate = Get-NormalizedPath $Path
    $profilePrefix = $profileRoot + [System.IO.Path]::DirectorySeparatorChar
    if (-not $candidate.StartsWith($profilePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Private package must be located below the current Windows profile: '$candidate'."
    }

    $cursor = $candidate
    while ($true) {
        $item = Get-Item -LiteralPath $cursor -Force
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Private package path contains a reparse point: '$cursor'."
        }
        if ([string]::Equals($cursor, $profileRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            break
        }
        $cursor = Get-NormalizedPath (Split-Path -Parent $cursor)
    }
}

function Get-PrivateTreeItems {
    param([Parameter(Mandatory)][string]$Root)

    $items = [System.Collections.Generic.List[System.IO.FileSystemInfo]]::new()
    $pending = [System.Collections.Generic.Queue[string]]::new()
    $pending.Enqueue($Root)
    while ($pending.Count -gt 0) {
        $directory = $pending.Dequeue()
        foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force)) {
            if ($items.Count -ge 8256) {
                throw "Private tree exceeds the supported 8256-entry limit: '$Root'."
            }
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "Private tree contains a reparse point: '$($item.FullName)'."
            }
            $items.Add($item)
            if ($item.PSIsContainer) {
                $pending.Enqueue($item.FullName)
            }
        }
    }
    return @($items)
}

$currentUserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$systemSid = [System.Security.Principal.SecurityIdentifier]::new(
    [System.Security.Principal.WellKnownSidType]::LocalSystemSid,
    $null
)

function Set-PrivateAcl {
    param([Parameter(Mandatory)][string]$Path)

    $item = Get-Item -LiteralPath $Path -Force
    $acl = if ($item.PSIsContainer) {
        [System.Security.AccessControl.DirectorySecurity]::new()
    }
    else {
        [System.Security.AccessControl.FileSecurity]::new()
    }
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($currentUserSid)

    $inheritance = if ($item.PSIsContainer) {
        [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    }
    else {
        [System.Security.AccessControl.InheritanceFlags]::None
    }
    foreach ($sid in @($currentUserSid, $systemSid)) {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
            $sid,
            [System.Security.AccessControl.FileSystemRights]::FullControl,
            $inheritance,
            [System.Security.AccessControl.PropagationFlags]::None,
            [System.Security.AccessControl.AccessControlType]::Allow
        )
        [void]$acl.AddAccessRule($rule)
    }

    $aclExtensions = 'System.IO.FileSystemAclExtensions' -as [type]
    if ($aclExtensions) {
        $aclExtensions::SetAccessControl($item, $acl)
    }
    else {
        $item.SetAccessControl($acl)
    }
}

function Assert-PrivateAcl {
    param([Parameter(Mandatory)][string]$Path)

    $item = Get-Item -LiteralPath $Path -Force
    $acl = Get-Acl -LiteralPath $Path
    if (-not $acl.AreAccessRulesProtected) {
        throw "ACL inheritance is still enabled: '$Path'."
    }
    if (-not $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Equals($currentUserSid)) {
        throw "ACL owner is not the current Windows user: '$Path'."
    }

    $expectedSids = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    [void]$expectedSids.Add($currentUserSid.Value)
    [void]$expectedSids.Add($systemSid.Value)
    $seenSids = [System.Collections.Generic.HashSet[string]]::new(
        [System.StringComparer]::OrdinalIgnoreCase
    )
    $expectedInheritance = if ($item.PSIsContainer) {
        [System.Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit'
    }
    else {
        [System.Security.AccessControl.InheritanceFlags]::None
    }

    foreach ($rule in @($acl.GetAccessRules(
        $true,
        $true,
        [System.Security.Principal.SecurityIdentifier]
    ))) {
        $sid = ([System.Security.Principal.SecurityIdentifier]$rule.IdentityReference).Value
        if (-not $expectedSids.Contains($sid) -or $rule.IsInherited) {
            throw "ACL contains an inherited or unexpected identity: '$Path'."
        }
        if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow -or
            $rule.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl -or
            $rule.InheritanceFlags -ne $expectedInheritance -or
            $rule.PropagationFlags -ne [System.Security.AccessControl.PropagationFlags]::None -or
            -not $seenSids.Add($sid)) {
            throw "ACL is not the canonical private package ACL: '$Path'."
        }
    }
    if ($seenSids.Count -ne $expectedSids.Count) {
        throw "ACL is missing the current-user or SYSTEM rule: '$Path'."
    }
    foreach ($stream in @(Get-Item -LiteralPath $Path -Stream * -ErrorAction Stop)) {
        if ([string]$stream.Stream -cne ':$DATA') {
            throw "Private package contains an alternate data stream: '$Path'."
        }
    }
}

function Protect-PrivateTree {
    param([Parameter(Mandatory)][string]$Root)

    $treeItems = @(Get-PrivateTreeItems -Root $Root)
    Set-PrivateAcl -Path $Root
    foreach ($directory in @($treeItems | Where-Object { $_.PSIsContainer } | Sort-Object { $_.FullName.Length })) {
        Set-PrivateAcl -Path $directory.FullName
    }
    foreach ($file in @($treeItems | Where-Object { -not $_.PSIsContainer })) {
        Set-PrivateAcl -Path $file.FullName
    }

    Assert-PrivateAcl -Path $Root
    foreach ($item in $treeItems) {
        Assert-PrivateAcl -Path $item.FullName
    }
}

$package = Get-NormalizedPath $PackageRoot
if (-not (Test-Path -LiteralPath $package -PathType Container)) {
    throw "Private package directory does not exist: '$package'."
}
if ((Split-Path -Leaf $package) -cne 'package') {
    throw "Private package directory must use the exact leaf name 'package': '$package'."
}

$state = Get-NormalizedPath $StateRoot
$localAppData = Get-NormalizedPath ([Environment]::GetFolderPath(
    [Environment+SpecialFolder]::LocalApplicationData
))
if (-not [string]::Equals(
    (Get-NormalizedPath (Split-Path -Parent $state)),
    $localAppData,
    [System.StringComparison]::OrdinalIgnoreCase
)) {
    throw "MCP state directory must be a direct child of LocalAppData: '$state'."
}
if (-not (Test-Path -LiteralPath $state)) {
    [void](New-Item -ItemType Directory -Path $state)
}
elseif (-not (Test-Path -LiteralPath $state -PathType Container)) {
    throw "MCP state path is not a directory: '$state'."
}

Assert-PathWithinProfile -Path $package
Assert-PathWithinProfile -Path $state
Protect-PrivateTree -Root $package
Protect-PrivateTree -Root $state

Write-Output "Secured private MCP package: $package"
Write-Output "Secured MCP state directory: $state"
