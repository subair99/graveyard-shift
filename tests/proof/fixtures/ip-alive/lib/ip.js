const ip = exports;
const { Buffer } = require('buffer');
const os = require('os');

ip.toBuffer = function (ip, buff, offset) {
  offset = ~~offset;

  let result;

  if (this.isV4Format(ip)) {
    result = buff || Buffer.alloc(offset + 4);
    ip.split(/\./g).map((byte) => {
      result[offset++] = parseInt(byte, 10) & 0xff;
    });
  } else if (this.isV6Format(ip)) {
    const sections = ip.split(':', 8);

    let i;
    for (i = 0; i < sections.length; i++) {
      const isv4 = this.isV4Format(sections[i]);
      let v4Buffer;

      if (isv4) {
        v4Buffer = this.toBuffer(sections[i]);
        sections[i] = v4Buffer.slice(0, 2).toString('hex');
      }

      if (v4Buffer && ++i < 8) {
        sections.splice(i, 0, v4Buffer.slice(2, 4).toString('hex'));
      }
    }

    if (sections[0] === '') {
      while (sections.length < 8) sections.unshift('0');
    } else if (sections[sections.length - 1] === '') {
      while (sections.length < 8) sections.push('0');
    } else if (sections.length < 8) {
      for (i = 0; i < sections.length && sections[i] !== ''; i++);
      const argv = [i, 1];
      for (i = 9 - sections.length; i > 0; i--) {
        argv.push('0');
      }
      sections.splice(...argv);
    }

    result = buff || Buffer.alloc(offset + 16);
    for (i = 0; i < sections.length; i++) {
      const word = parseInt(sections[i], 16);
      result[offset++] = (word >> 8) & 0xff;
      result[offset++] = word & 0xff;
    }
  }

  if (!result) {
    throw Error(`Invalid ip address: ${ip}`);
  }

  return result;
};

ip.toString = function (buff, offset, length) {
  offset = ~~offset;
  length = length || (buff.length - offset);

  let result = [];
  if (length === 4) {
    // IPv4
    for (let i = 0; i < length; i++) {
      result.push(buff[offset + i]);
    }
    result = result.join('.');
  } else if (length === 16) {
    // IPv6
    for (let i = 0; i < length; i += 2) {
      result.push(buff.readUInt16BE(offset + i).toString(16));
    }
    result = result.join(':');
    result = result.replace(/(^|:)0(:0)*:0(:|$)/, '$1::$3');
    result = result.replace(/:{3,4}/, '::');
  }

  return result;
};

const ipv4Regex = /^(\d{1,3}\.){3,3}\d{1,3}$/;
const ipv6Regex = /^(::)?(((\d{1,3}\.){3}(\d{1,3}){1})?([0-9a-f]){0,4}:{0,2}){1,8}(::)?$/i;

ip.isV4Format = function (ip) {
  return ipv4Regex.test(ip);
};

ip.isV6Format = function (ip) {
  return ipv6Regex.test(ip);
};

function _normalizeFamily(family) {
  if (family === 4) {
    return 'ipv4';
  }
  if (family === 6) {
    return 'ipv6';
  }
  return family ? family.toLowerCase() : 'ipv4';
}

ip.fromPrefixLen = function (prefixlen, family) {
  if (prefixlen > 32) {
    family = 'ipv6';
  } else {
    family = _normalizeFamily(family);
  }

  let len = 4;
  if (family === 'ipv6') {
    len = 16;
  }
  const buff = Buffer.alloc(len);

  for (let i = 0, n = buff.length; i < n; ++i) {
    let bits = 8;
    if (prefixlen < 8) {
      bits = prefixlen;
    }
    prefixlen -= bits;

    buff[i] = ~(0xff >> bits) & 0xff;
  }

  return ip.toString(buff);
};

ip.mask = function (addr, mask) {
  addr = ip.toBuffer(addr);
  mask = ip.toBuffer(mask);

  const result = Buffer.alloc(Math.max(addr.length, mask.length));

  // Same protocol - do bitwise and
  let i;
  if (addr.length === mask.length) {
    for (i = 0; i < addr.length; i++) {
      result[i] = addr[i] & mask[i];
    }
  } else if (mask.length === 4) {
    // IPv6 address and IPv4 mask
    // (Mask low bits)
    for (i = 0; i < mask.length; i++) {
      result[i] = addr[addr.length - 4 + i] & mask[i];
    }
  } else {
    // IPv6 mask and IPv4 addr
    for (i = 0; i < result.length - 6; i++) {
      result[i] = 0;
    }

    // ::ffff:ipv4
    result[10] = 0xff;
    result[11] = 0xff;
    for (i = 0; i < addr.length; i++) {
      result[i + 12] = addr[i] & mask[i + 12];
    }
    i += 12;
  }
  for (; i < result.length; i++) {
    result[i] = 0;
  }

  return ip.toString(result);
};

ip.cidr = function (cidrString) {
  const cidrParts = cidrString.split('/');

  const addr = cidrParts[0];
  if (cidrParts.length !== 2) {
    throw new Error(`invalid CIDR subnet: ${addr}`);
  }

  const mask = ip.fromPrefixLen(parseInt(cidrParts[1], 10));

  return ip.mask(addr, mask);
};

ip.subnet = function (addr, mask) {
  const networkAddress = ip.toLong(ip.mask(addr, mask));

  // Calculate the mask's length.
  const maskBuffer = ip.toBuffer(mask);
  let maskLength = 0;

  for (let i = 0; i < maskBuffer.length; i++) {
    if (maskBuffer[i] === 0xff) {
      maskLength += 8;
    } else {
      let octet = maskBuffer[i] & 0xff;
      while (octet) {
        octet = (octet << 1) & 0xff;
        maskLength++;
      }
    }
  }

  const numberOfAddresses = 2 ** (32 - maskLength);

  return {
    networkAddress: ip.fromLong(networkAddress),
    firstAddress: numberOfAddresses <= 2
      ? ip.fromLong(networkAddress)
      : ip.fromLong(networkAddress + 1),
    lastAddress: numberOfAddresses <= 2
      ? ip.fromLong(networkAddress + numberOfAddresses - 1)
      : ip.fromLong(networkAddress + numberOfAddresses - 2),
    broadcastAddress: ip.fromLong(networkAddress + numberOfAddresses - 1),
    subnetMask: mask,
    subnetMaskLength: maskLength,
    numHosts: numberOfAddresses <= 2
      ? numberOfAddresses : numberOfAddresses - 2,
    length: numberOfAddresses,
    contains(other) {
      return networkAddress === ip.toLong(ip.mask(other, mask));
    },
  };
};

ip.cidrSubnet = function (cidrString) {
  const cidrParts = cidrString.split('/');

  const addr = cidrParts[0];
  if (cidrParts.length !== 2) {
    throw new Error(`invalid CIDR subnet: ${addr}`);
  }

  const mask = ip.fromPrefixLen(parseInt(cidrParts[1], 10));

  return ip.subnet(addr, mask);
};

ip.not = function (addr) {
  const buff = ip.toBuffer(addr);
  for (let i = 0; i < buff.length; i++) {
    buff[i] = 0xff ^ buff[i];
  }
  return ip.toString(buff);
};

ip.or = function (a, b) {
  a = ip.toBuffer(a);
  b = ip.toBuffer(b);

  // same protocol
  if (a.length === b.length) {
    for (let i = 0; i < a.length; ++i) {
      a[i] |= b[i];
    }
    return ip.toString(a);

  // mixed protocols
  }
  let buff = a;
  let other = b;
  if (b.length > a.length) {
    buff = b;
    other = a;
  }

  const offset = buff.length - other.length;
  for (let i = offset; i < buff.length; ++i) {
    buff[i] |= other[i - offset];
  }

  return ip.toString(buff);
};

ip.isEqual = function (a, b) {
  a = ip.toBuffer(a);
  b = ip.toBuffer(b);

  // Same protocol
  if (a.length === b.length) {
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  // Swap
  if (b.length === 4) {
    const t = b;
    b = a;
    a = t;
  }

  // a - IPv4, b - IPv6
  for (let i = 0; i < 10; i++) {
    if (b[i] !== 0) return false;
  }

  const word = b.readUInt16BE(10);
  if (word !== 0 && word !== 0xffff) return false;

  for (let i = 0; i < 4; i++) {
    if (a[i] !== b[i + 12]) return false;
  }

  return true;
};

ip.isPrivate = function (addr) {
  // check loopback addresses first
  if (ip.isLoopback(addr)) {
    return true;
  }

  // ensure the ipv4 address is valid
  if (!ip.isV6Format(addr)) {
    const ipl = ip.normalizeToLong(addr);
    if (ipl < 0) {
      throw new Error('invalid ipv4 address');
    }
    // normalize the address for the private range checks that follow
    addr = ip.fromLong(ipl);
  }

  // check private ranges
  return /^(::f{4}:)?10\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(addr)
    || /^(::f{4}:)?192\.168\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(addr)
    || /^(::f{4}:)?172\.(1[6-9]|2\d|30|31)\.([0-9]{1,3})\.([0-9]{1,3})$/i
      .test(addr)
    || /^(::f{4}:)?169\.254\.([0-9]{1,3})\.([0-9]{1,3})$/i.test(addr)
    || /^f[cd][0-9a-f]{2}:/i.test(addr)
    || /^fe80:/i.test(addr)
    || /^::1$/.test(addr)
    || /^::$/.test(addr);
};

// Hand-written fix for GHSA-2p57-rm9w-gvfp. inNonPublicAddressClass is a plain-JS copy of the strict parser
// and range table in src/pipeline/harness/core/presets/ipNonPublicAddress.ts (Graveyard Shift repository).
// The "Lines" comments name the lines of that file each part mirrors. Parse failure means not in class.
var inNonPublicAddressClass = (function () {
  // Lines 73-74: V4_BITS, V6_BITS. BigInt values as in the source (Node 10.4 or later); no 0n literals.
  var V4_BITS = 32;
  var V6_BITS = 128;
  var ZERO = BigInt(0);
  var EIGHT = BigInt(8);
  var SIXTEEN = BigInt(16);
  var BIT_SHIFT_32 = BigInt(32);
  var FF = BigInt(255);
  var FFFF = BigInt(0xffff);
  var FFFFFFFF = BigInt(0xffffffff);

  // Lines 77-83 (V4_RANGES) and 85-90 (V6_RANGES): [network, prefix length]
  var V4_RANGES = [
    ['127.0.0.0', 8],
    ['10.0.0.0', 8],
    ['192.168.0.0', 16],
    ['172.16.0.0', 12],
    ['169.254.0.0', 16]
  ];
  var V6_RANGES = [
    ['::1', 128],
    ['::', 128],
    ['fc00::', 7],
    ['fe80::', 16]
  ];

  // Lines 96-100: the part patterns
  var DEC = /^[1-9][0-9]*$/;
  var OCT = /^0[0-7]*$/;
  var HEX = /^0[xX][0-9a-fA-F]+$/;
  var GROUP = /^[0-9a-fA-F]{1,4}$/;
  var QUAD_PART = /^(?:0|[1-9][0-9]{0,2})$/;

  // Lines 102-108: one IPv4 part, hexadecimal, octal (leading zero) or decimal
  function parseV4Part(part) {
    if (part.length > 12) return null;
    if (HEX.test(part)) return BigInt(part);
    if (OCT.test(part)) return BigInt('0o' + part);
    if (DEC.test(part)) return BigInt(part);
    return null;
  }

  // Lines 111-128: inet_aton style, 1 to 4 parts, the last one fills the remaining bytes
  function parseV4(text) {
    var parts = text.split('.');
    if (parts.length < 1 || parts.length > 4) return null;
    var value = ZERO;
    for (var i = 0; i < parts.length; i++) {
      var n = parseV4Part(parts[i]);
      if (n === null) return null;
      if (i < parts.length - 1) {
        if (n > FF) return null;
        value = (value << EIGHT) | n;
      } else {
        var bytesLeft = 4 - i;
        if (n >= (BigInt(1) << BigInt(8 * bytesLeft))) return null;
        value = (value << BigInt(8 * bytesLeft)) | n;
      }
    }
    return value;
  }

  // Lines 131-142: strict dotted decimal, exactly four parts 0 to 255
  function parseDottedQuad(text) {
    var parts = text.split('.');
    if (parts.length !== 4) return null;
    var value = ZERO;
    for (var i = 0; i < parts.length; i++) {
      if (!QUAD_PART.test(parts[i])) return null;
      var n = Number(parts[i]);
      if (n > 255) return null;
      value = (value << EIGHT) | BigInt(n);
    }
    return value;
  }

  // Lines 144-152: a run of colon separated groups of 1 to 4 hex digits
  function parseGroups(text) {
    if (text === '') return [];
    var groups = [];
    var pieces = text.split(':');
    for (var i = 0; i < pieces.length; i++) {
      if (!GROUP.test(pieces[i])) return null;
      groups.push(BigInt('0x' + pieces[i]));
    }
    return groups;
  }

  // Lines 154-184: IPv6 with at most one "::" and an optional dotted IPv4 tail
  function parseV6(input) {
    var text = input;
    var lastColon = text.lastIndexOf(':');
    if (lastColon < 0) return null;
    var tail = text.slice(lastColon + 1);
    if (tail.indexOf('.') >= 0) {
      var quad = parseDottedQuad(tail);
      if (quad === null) return null;
      var hi = (quad >> SIXTEEN).toString(16);
      var lo = (quad & FFFF).toString(16);
      text = text.slice(0, lastColon + 1) + hi + ':' + lo;
    }
    var halves = text.split('::');
    if (halves.length > 2) return null;
    var groups;
    if (halves.length === 2) {
      var left = parseGroups(halves[0]);
      var right = parseGroups(halves[1]);
      if (left === null || right === null) return null;
      var missing = 8 - left.length - right.length;
      if (missing < 1) return null;
      var zeros = [];
      for (var z = 0; z < missing; z++) zeros.push(ZERO);
      groups = left.concat(zeros, right);
    } else {
      var all = parseGroups(text);
      if (all === null || all.length !== 8) return null;
      groups = all;
    }
    var value = ZERO;
    for (var g = 0; g < groups.length; g++) value = (value << SIXTEEN) | groups[g];
    return value;
  }

  // Lines 190-210 (Range, buildRanges, V4_TABLE, V6_TABLE): the range tables, built once at load time
  function buildRanges(rows, bits, parse) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var network = parse(rows[i][0]);
      var length = rows[i][1];
      if (network === null || length < 0 || length > bits) {
        throw new Error('inNonPublicAddressClass: bad range ' + rows[i][0] + '/' + length);
      }
      out.push({ network: network, length: length });
    }
    return out;
  }
  var V4_TABLE = buildRanges(V4_RANGES, V4_BITS, parseDottedQuad);
  var V6_TABLE = buildRanges(V6_RANGES, V6_BITS, parseV6);

  // Lines 212-217: inRanges, is the address inside one of the ranges
  function inRanges(address, bits, table) {
    return table.some(function (range) {
      var shift = BigInt(bits - range.length);
      return (address >> shift) === (range.network >> shift);
    });
  }

  // Lines 224-234: isNonPublicAddress. Non-strings and unparseable text give false.
  // An IPv4-mapped IPv6 address (::ffff:0:0/96) is classified by its embedded IPv4 address.
  return function (input) {
    if (typeof input !== 'string') return false;
    if (input.indexOf(':') >= 0) {
      var v6 = parseV6(input);
      if (v6 === null) return false;
      if ((v6 >> BIT_SHIFT_32) === FFFF) return inRanges(v6 & FFFFFFFF, V4_BITS, V4_TABLE);
      return inRanges(v6, V6_BITS, V6_TABLE);
    }
    var v4 = parseV4(input);
    return v4 === null ? false : inRanges(v4, V4_BITS, V4_TABLE);
  };
}());

ip.isPublic = function (addr) {
  if (inNonPublicAddressClass(addr)) {
    return false;
  }
  return !ip.isPrivate(addr);
};

ip.isLoopback = function (addr) {
  // If addr is an IPv4 address in long integer form (no dots and no colons), convert it
  if (!/\./.test(addr) && !/:/.test(addr)) {
    addr = ip.fromLong(Number(addr));
  }

  return /^(::f{4}:)?127\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})/
    .test(addr)
    || /^0177\./.test(addr)
    || /^0x7f\./i.test(addr)
    || /^fe80::1$/i.test(addr)
    || /^::1$/.test(addr)
    || /^::$/.test(addr);
};

ip.loopback = function (family) {
  //
  // Default to `ipv4`
  //
  family = _normalizeFamily(family);

  if (family !== 'ipv4' && family !== 'ipv6') {
    throw new Error('family must be ipv4 or ipv6');
  }

  return family === 'ipv4' ? '127.0.0.1' : 'fe80::1';
};

//
// ### function address (name, family)
// #### @name {string|'public'|'private'} **Optional** Name or security
//      of the network interface.
// #### @family {ipv4|ipv6} **Optional** IP family of the address (defaults
//      to ipv4).
//
// Returns the address for the network interface on the current system with
// the specified `name`:
//   * String: First `family` address of the interface.
//             If not found see `undefined`.
//   * 'public': the first public ip address of family.
//   * 'private': the first private ip address of family.
//   * undefined: First address with `ipv4` or loopback address `127.0.0.1`.
//
ip.address = function (name, family) {
  const interfaces = os.networkInterfaces();

  //
  // Default to `ipv4`
  //
  family = _normalizeFamily(family);

  //
  // If a specific network interface has been named,
  // return the address.
  //
  if (name && name !== 'private' && name !== 'public') {
    const res = interfaces[name].filter((details) => {
      const itemFamily = _normalizeFamily(details.family);
      return itemFamily === family;
    });
    if (res.length === 0) {
      return undefined;
    }
    return res[0].address;
  }

  const all = Object.keys(interfaces).map((nic) => {
    //
    // Note: name will only be `public` or `private`
    // when this is called.
    //
    const addresses = interfaces[nic].filter((details) => {
      details.family = _normalizeFamily(details.family);
      if (details.family !== family || ip.isLoopback(details.address)) {
        return false;
      } if (!name) {
        return true;
      }

      return name === 'public' ? ip.isPrivate(details.address)
        : ip.isPublic(details.address);
    });

    return addresses.length ? addresses[0].address : undefined;
  }).filter(Boolean);

  return !all.length ? ip.loopback(family) : all[0];
};

ip.toLong = function (ip) {
  let ipl = 0;
  ip.split('.').forEach((octet) => {
    ipl <<= 8;
    ipl += parseInt(octet);
  });
  return (ipl >>> 0);
};

ip.fromLong = function (ipl) {
  return (`${ipl >>> 24}.${
    ipl >> 16 & 255}.${
    ipl >> 8 & 255}.${
    ipl & 255}`);
};

ip.normalizeToLong = function (addr) {
  const parts = addr.split('.').map(part => {
    // Handle hexadecimal format
    if (part.startsWith('0x') || part.startsWith('0X')) {
      return parseInt(part, 16);
    }
    // Handle octal format (strictly digits 0-7 after a leading zero)
    else if (part.startsWith('0') && part !== '0' && /^[0-7]+$/.test(part)) {
      return parseInt(part, 8);
    }
    // Handle decimal format, reject invalid leading zeros
    else if (/^[1-9]\d*$/.test(part) || part === '0') {
      return parseInt(part, 10);
    }
    // Return NaN for invalid formats to indicate parsing failure
    else {
      return NaN;
    }
  });

  if (parts.some(isNaN)) return -1; // Indicate error with -1

  let val = 0;
  const n = parts.length;

  switch (n) {
  case 1:
    val = parts[0];
    break;
  case 2:
    if (parts[0] > 0xff || parts[1] > 0xffffff) return -1;
    val = (parts[0] << 24) | (parts[1] & 0xffffff);
    break;
  case 3:
    if (parts[0] > 0xff || parts[1] > 0xff || parts[2] > 0xffff) return -1;
    val = (parts[0] << 24) | (parts[1] << 16) | (parts[2] & 0xffff);
    break;
  case 4:
    if (parts.some(part => part > 0xff)) return -1;
    val = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
    break;
  default:
    return -1; // Error case
  }

  return val >>> 0;
};
