#!/usr/bin/env node
/**
 * Prepare the CUDA runtime the local Kokoro engine can use.
 *
 * onnxruntime-node ships CPU only, so the CUDA provider and the CUDA 12
 * runtime it was built against are fetched here into the plugin's own
 * storage. Nothing is installed system-wide and nothing is added to the
 * plugin bundle: the host passes these directories to its worker through
 * LD_LIBRARY_PATH.
 */
import { execFileSync } from 'node:child_process'
import { mkdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const ORT_VERSION = '1.21.0'
const root = join(homedir(), '.dsh', 'dsh-english-reader', 'vendor')
const ortDir = join(root, 'ort-gpu')
const cudaDir = join(root, 'cuda12')
const url = `https://github.com/microsoft/onnxruntime/releases/download/v${ORT_VERSION}/onnxruntime-linux-x64-gpu-${ORT_VERSION}.tgz`

async function exists(path) {
  try { await stat(path); return true } catch { return false }
}

console.log(`[1/2] onnxruntime CUDA provider ${ORT_VERSION}`)
if (await exists(join(ortDir, 'libonnxruntime_providers_cuda.so'))) {
  console.log('      already present, skipping')
} else {
  await mkdir(ortDir, { recursive: true })
  const archive = join(root, `ort-gpu-${ORT_VERSION}.tgz`)
  console.log(`      downloading ${url}`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`)
  await (await import('node:fs/promises')).writeFile(archive, Buffer.from(await response.arrayBuffer()))
  const extract = join(root, 'ort-extract')
  await rm(extract, { recursive: true, force: true })
  await mkdir(extract, { recursive: true })
  execFileSync('tar', ['-xzf', archive, '-C', extract])
  const inner = join(extract, `onnxruntime-linux-x64-gpu-${ORT_VERSION}`, 'lib')
  execFileSync('cp', ['-a', `${inner}/.`, ortDir])
  await rm(extract, { recursive: true, force: true })
  await rm(archive, { force: true })
  if (!await exists(join(ortDir, 'libonnxruntime_providers_cuda.so'))) {
    throw new Error('the provider library is missing after extraction')
  }
  console.log('      provider installed')
}

console.log('[2/2] CUDA 12 runtime')
if (await exists(join(cudaDir, 'libcudart.so.12'))) {
  console.log('      already present, skipping')
} else {
  console.log('      onnxruntime 1.21 needs CUDA 12. The machine has a different major version,')
  console.log('      so fetch the runtime wheels into the plugin folder instead of the system:')
  console.log('')
  console.log(`        pip download --no-deps -d /tmp/cuda12 nvidia-cuda-runtime-cu12 nvidia-cublas-cu12 nvidia-cudnn-cu12`)
  console.log(`        mkdir -p ${cudaDir}`)
  console.log(`        for w in /tmp/cuda12/*.whl; do unzip -o -q "$w" 'nvidia/*/lib/*' -d /tmp/cuda12x; done`)
  console.log(`        cp -a /tmp/cuda12x/nvidia/*/lib/. ${cudaDir}/`)
  console.log('')
  console.log('      Then reload the plugin and pick GPU in the engine section.')
}

console.log('done. Reload the plugin (disable + enable) and open the engine section.')
