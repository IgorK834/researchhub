"""Strict, bounded runtime wire protocol. Container isolation remains the Java runner's responsibility."""
import hashlib
import json
import math
import re
import stat
from pathlib import Path
from uuid import UUID
import xml.etree.ElementTree as ET

MAX_RESULT_BYTES = 1_048_576
MAX_ARTIFACT_BYTES = 8 * 1_048_576
MAX_TOTAL_BYTES = 16 * 1_048_576
MAX_CODE_BYTES = 32_000
FILE_NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,95}\.(?:png|svg)\Z')
HASH = re.compile(r'[0-9a-f]{64}\Z')
KINDS = {'TABLE', 'CHART', 'TEXT'}


class ProtocolError(ValueError):
    """Only the allowlisted error code leaves the trusted runtime."""


def reject():
    raise ProtocolError('SANDBOX_OUTPUT_INVALID')


def keys(value, expected):
    if type(value) is not dict or set(value) != set(expected):
        reject()


def string(value, maximum, nonblank=True):
    if type(value) is not str or len(value) > maximum or nonblank and not value.strip():
        reject()
    if any(ord(char) < 32 and char not in '\n\r\t' for char in value):
        reject()
    return value


def pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            reject()
        result[key] = value
    return result


def regular_file(path, cap):
    # lstat + bounded reads; after untrusted execution the host pauses the container and repeats collection checks.
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > cap:
        reject()
    with path.open('rb') as stream:
        value = stream.read(cap + 1)
    if len(value) > cap:
        reject()
    return value


def load_json(path, cap):
    def constant(_):
        reject()
    try:
        return json.loads(regular_file(path, cap).decode('utf-8'), object_pairs_hook=pairs, parse_constant=constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError):
        reject()


def validate_manifest(path=Path('/execution/manifest.json'), inputs_root=Path('/inputs')):
    manifest = load_json(path, 65_536)
    keys(manifest, ('schemaVersion', 'inputs', 'outputs'))
    if manifest['schemaVersion'] != '1.0' or type(manifest['inputs']) is not list or not 1 <= len(manifest['inputs']) <= 5:
        reject()
    seen = set()
    for item in manifest['inputs']:
        keys(item, ('sourceVersionId', 'format', 'file', 'sha256'))
        identity = string(item['sourceVersionId'], 36)
        try:
            if str(UUID(identity)) != identity:
                reject()
        except ValueError:
            reject()
        if identity in seen or item['format'] not in ('CSV', 'XLSX'):
            reject()
        seen.add(identity)
        expected = '/inputs/' + identity + '.' + item['format'].lower()
        if item['file'] != expected or type(item['sha256']) is not str or not HASH.fullmatch(item['sha256']):
            reject()
        content = regular_file(inputs_root / Path(expected).name, 50 * 1_048_576)
        if hashlib.sha256(content).hexdigest() != item['sha256']:
            reject()
    outputs = manifest['outputs']
    if type(outputs) is not list or not 1 <= len(outputs) <= 10:
        reject()
    seen = set()
    for item in outputs:
        keys(item, ('name', 'kind'))
        name = string(item['name'], 100)
        if name in seen or item['kind'] not in KINDS:
            reject()
        seen.add(name)
    return manifest


def chart(content, extension):
    if extension == '.png':
        if not content.startswith(b'\x89PNG\r\n\x1a\n'):
            reject()
        return
    if b'<!DOCTYPE' in content.upper() or b'<!ENTITY' in content.upper():
        reject()
    try:
        root = ET.fromstring(content)
    except (ET.ParseError, RecursionError):
        reject()
    if root.tag not in ('svg', '{http://www.w3.org/2000/svg}svg'):
        reject()
    for element in root.iter():
        tag = element.tag.rsplit('}', 1)[-1].lower()
        if tag in ('script', 'foreignobject', 'iframe', 'object', 'embed', 'image', 'a', 'style'):
            reject()
        for key, value in element.attrib.items():
            key = key.rsplit('}', 1)[-1].lower()
            if key.startswith('on') or key in ('href', 'src') and not value.startswith('#'):
                reject()
            if 'url(' in value.lower() and not re.fullmatch(r'url\(#[A-Za-z0-9_-]+\)', value):
                reject()


def scalar(value):
    if value is None or type(value) in (bool, int):
        return
    if type(value) is float and math.isfinite(value):
        return
    if type(value) is str:
        string(value, 1024, False)
        return
    reject()


def validate_result(manifest, outputs_root=Path('/outputs')):
    result_path = outputs_root / 'result.json'
    raw = regular_file(result_path, MAX_RESULT_BYTES)
    result = load_json(result_path, MAX_RESULT_BYTES)
    keys(result, ('schemaVersion', 'outputs'))
    outputs = result['outputs']
    expected = {item['name']: item['kind'] for item in manifest['outputs']}
    if result['schemaVersion'] != '1.0' or type(outputs) is not list or len(outputs) != len(expected):
        reject()
    names, files = set(), {'result.json'}
    total, cells = len(raw), 0
    for item in outputs:
        if type(item) is not dict:
            reject()
        name, kind = item.get('name'), item.get('kind')
        string(name, 100)
        if name in names or expected.get(name) != kind:
            reject()
        names.add(name)
        if kind == 'TABLE':
            keys(item, ('name', 'kind', 'columns', 'rows'))
            columns, rows = item['columns'], item['rows']
            if type(columns) is not list or not 1 <= len(columns) <= 100 or type(rows) is not list or len(rows) > 10_000:
                reject()
            for column in columns:
                string(column, 256)
            if len(set(columns)) != len(columns):
                reject()
            for row in rows:
                if type(row) is not list or len(row) != len(columns):
                    reject()
                cells += len(row)
                if cells > 100_000:
                    reject()
                for value in row:
                    scalar(value)
        elif kind == 'TEXT':
            keys(item, ('name', 'kind', 'text'))
            string(item['text'], 65_536, False)
        elif kind == 'CHART':
            keys(item, ('name', 'kind', 'file'))
            filename = string(item['file'], 100)
            if not FILE_NAME.fullmatch(filename) or filename in files:
                reject()
            files.add(filename)
            content = regular_file(outputs_root / filename, MAX_ARTIFACT_BYTES)
            total += len(content)
            chart(content, Path(filename).suffix)
        else:
            reject()
    if total > MAX_TOTAL_BYTES or {path.name for path in outputs_root.iterdir()} != files:
        reject()
    return result
