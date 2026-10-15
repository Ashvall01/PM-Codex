import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

interface AIAvatarProps {
  state: 'idle' | 'thinking' | 'responding';
  className?: string;
}

export const AIAvatar: React.FC<AIAvatarProps> = ({ state, className = 'w-10 h-10' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);

  // Keep state ref updated for use inside the animation loop
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Dimensions
    const width = container.clientWidth || 40;
    const height = container.clientHeight || 40;

    // 1. Scene setup
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x0a1520, 0.05);

    // 2. Camera setup
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.z = 6;

    // 3. Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    // 4. Post-processing Bloom
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.5,  // strength
      0.01,  // radius
      0.6   // threshold
    );

    const outerGlowPass = new UnrealBloomPass(
      new THREE.Vector2(width, height),
      0.1,  // strength
      0.03,  // radius
      0.1   // threshold
    );

    const composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
    composer.addPass(outerGlowPass);

    // 5. Cephalon Group
    const cephalonGroup = new THREE.Group();
    scene.add(cephalonGroup);

    // --- Core (Octahedron) ---
    const coreGeo = new THREE.OctahedronGeometry(2, 0);

    const coreVertexShader = `
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec3 vViewDirection;

      void main() {
        vNormal = normalize(normalMatrix * normal);
        vPosition = position;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewDirection = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix * mvPosition;
      }
    `;

    const coreFragmentShader = `
      uniform vec3 color;
      uniform float time;
      uniform float intensity;
      
      varying vec3 vNormal;
      varying vec3 vPosition;
      varying vec3 vViewDirection;

      void main() {
        float dist = length(vPosition);
        float radialGlow = smoothstep(2.5, 0.0, dist);
        
        float facingRatio = dot(vNormal, vViewDirection);
        float rim = pow(1.0 - max(0.0, facingRatio), 3.0);
        float direct = pow(max(0.0, facingRatio), 2.0);
        
        float combinedGlow = (radialGlow * 0.4) + (rim * 0.8) + (direct * 0.3);
        combinedGlow *= intensity;
        
        gl_FragColor = vec4(color * combinedGlow, min(combinedGlow, 1.0));
      }
    `;

    const coreMat = new THREE.ShaderMaterial({
      uniforms: {
        color: { value: new THREE.Color(0x00e5ff) },
        time: { value: 0.0 },
        intensity: { value: 1.5 }
      },
      vertexShader: coreVertexShader,
      fragmentShader: coreFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    cephalonGroup.add(core);

    // Inner Core
    const innerCoreGeo = new THREE.OctahedronGeometry(1.4, 0);
    const innerCoreMat = new THREE.MeshStandardMaterial({
      color: 0x004466,
      emissive: 0x0088cc,
      emissiveIntensity: 0.8,
      flatShading: true,
    });
    const innerCore = new THREE.Mesh(innerCoreGeo, innerCoreMat);
    cephalonGroup.add(innerCore);

    // --- Shards ---
    const shards: Array<{
      mesh: THREE.Mesh;
      baseX: number;
      baseY: number;
      baseZ: number;
      targetPosition: THREE.Vector3;
      radius: number;
      speed: number;
      offset: number;
      rotSpeedX: number;
      rotSpeedY: number;
      rotSpeedZ: number;
    }> = [];
    const numShards = 35;
    const shardGeo = new THREE.TetrahedronGeometry(0.4, 0);
    
    const shardMat = new THREE.MeshStandardMaterial({
      color: 0x1a202c,
      metalness: 0.6,
      roughness: 0.5,
      emissive: 0x00e5ff,
      emissiveIntensity: 0.1,
      flatShading: true,
    });

    for (let i = 0; i < numShards; i++) {
      const mat = shardMat.clone() as THREE.MeshStandardMaterial;
      const shard = new THREE.Mesh(shardGeo, mat);

      const radius = 1.8 + Math.random() * 2.0;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);

      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);

      shard.position.set(x, y, z);
      shard.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      
      const scale = 0.5 + Math.random() * 0.8;
      shard.scale.set(scale, scale, scale);

      shards.push({
        mesh: shard,
        baseX: x,
        baseY: y,
        baseZ: z,
        targetPosition: new THREE.Vector3(x, y, z),
        radius,
        speed: 0.5 + Math.random() * 1.5,
        offset: Math.random() * Math.PI * 2,
        rotSpeedX: (Math.random() - 0.5) * 0.02,
        rotSpeedY: (Math.random() - 0.5) * 0.02,
        rotSpeedZ: (Math.random() - 0.5) * 0.02,
      });

      cephalonGroup.add(shard);
    }

    // --- Lighting ---
    const ambientLight = new THREE.AmbientLight(0x002244, 0.2);
    scene.add(ambientLight);

    const coreLight = new THREE.PointLight(0x00e5ff, 15, 20);
    cephalonGroup.add(coreLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.15);
    dirLight.position.set(5, 5, 5);
    scene.add(dirLight);

    const dirLight2 = new THREE.DirectionalLight(0x00aaff, 0.1);
    dirLight2.position.set(-5, -5, -5);
    scene.add(dirLight2);

    // --- Particles ---
    const particleGeo = new THREE.BufferGeometry();
    const particleCount = 100;
    const posArray = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount * 3; i++) {
      posArray[i] = (Math.random() - 0.5) * 15;
    }
    particleGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    const particleMat = new THREE.PointsMaterial({
      size: 0.05,
      color: 0x00e5ff,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    scene.add(particles);

    // Track Cursor
    let mouseX = 0;
    let mouseY = 0;
    let targetRotationX = 0;
    let targetRotationY = 0;

    const handleMouseMove = (event: MouseEvent) => {
      mouseX = (event.clientX / window.innerWidth) * 2 - 1;
      mouseY = -(event.clientY / window.innerHeight) * 2 + 1;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (event.touches.length > 0) {
        mouseX = (event.touches[0].clientX / window.innerWidth) * 2 - 1;
        mouseY = -(event.touches[0].clientY / window.innerHeight) * 2 + 1;
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove, { passive: true });

    // Handle container resize
    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      composer.setSize(w, h);
    };

    // Resize observer is standard and handles accurate element size tracking
    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(container);

    // State update and animation loop
    let animationFrameId: number;
    let time = 0;
    let lastActiveState = '';

    function smoothNoise(t: number) {
      return Math.sin(t) * Math.cos(t * 1.5) * Math.sin(t * 0.5);
    }

    // The avatar is 44px wide and sits in a panel that is usually closed, yet
    // it rendered a WebGL scene with two bloom passes 60 times a second on
    // every screen of the app. It now draws only while it can be seen, and at
    // 30 frames a second — the motion runs at the same speed as before.
    let visible = true;
    let running = false;
    let lastFrame = 0;
    const FRAME_MS = 1000 / 30;

    const animateLoop = (now: number = performance.now()) => {
      if (!visible) { running = false; return; }
      running = true;
      animationFrameId = requestAnimationFrame(animateLoop);
      if (lastFrame && now - lastFrame < FRAME_MS - 1) return;
      const steps = lastFrame ? Math.min(4, (now - lastFrame) / (1000 / 60)) : 1;
      lastFrame = now;
      time += 0.016 * steps;

      const currentState = stateRef.current;

      // When state changes, apply immediate color updates once
      if (currentState !== lastActiveState) {
        lastActiveState = currentState;
        if (currentState === 'idle') {
          coreMat.uniforms.intensity.value = 1.5;
          coreMat.uniforms.color.value.setHex(0x00e5ff);
          coreLight.intensity = 15;
          coreLight.color.setHex(0x00e5ff);
        } else if (currentState === 'thinking') {
          coreMat.uniforms.intensity.value = 1.5;
          coreMat.uniforms.color.value.setHex(0xff3333);
          coreLight.intensity = 20;
          coreLight.color.setHex(0xff0000);
        } else if (currentState === 'responding') {
          coreMat.uniforms.intensity.value = 1.5;
          coreMat.uniforms.color.value.setHex(0x00ffff);
          coreLight.intensity = 25;
          coreLight.color.setHex(0x00ffff);
        }
      }

      // Main Uniform update
      coreMat.uniforms.time.value = time;

      // Parallax look
      targetRotationY = mouseX * 0.8;
      targetRotationX = mouseY * 0.8;

      cephalonGroup.rotation.y += (targetRotationY - cephalonGroup.rotation.y) * 0.05;
      cephalonGroup.rotation.x += (-targetRotationX - cephalonGroup.rotation.x) * 0.05;

      // Float bobbing
      cephalonGroup.position.y = Math.sin(time * 2) * 0.3;
      cephalonGroup.position.x = Math.cos(time * 1.5) * 0.1;

      particles.rotation.y = time * 0.05;

      // State specific movements
      if (currentState === 'idle') {
        core.rotation.y += 0.005;
        core.rotation.x += 0.003;
        innerCore.rotation.y -= 0.004;

        const pulse = 1 + Math.sin(time * 3) * 0.05;
        core.scale.set(pulse, pulse, pulse);
        coreLight.intensity = 15 + Math.sin(time * 3) * 5;

        shards.forEach(shardData => {
          const { baseX, baseY, baseZ, offset, speed, targetPosition } = shardData;
          targetPosition.x = baseX + Math.sin(time * speed + offset) * 0.2;
          targetPosition.y = baseY + Math.cos(time * speed * 0.8 + offset) * 0.2;
          targetPosition.z = baseZ + Math.sin(time * speed * 1.2 + offset) * 0.2;

          shardData.mesh.rotation.x += shardData.rotSpeedX;
          shardData.mesh.rotation.y += shardData.rotSpeedY;
          if (shardData.mesh.material instanceof THREE.MeshStandardMaterial) {
            shardData.mesh.material.emissiveIntensity = 0.1;
          }
        });
      } else if (currentState === 'thinking') {
        core.rotation.y += 0.02;
        core.rotation.z += 0.01;
        innerCore.rotation.y -= 0.015;

        const pulse = 1 + Math.sin(time * 8) * 0.08;
        core.scale.set(pulse, pulse, pulse);
        coreLight.intensity = 20 + Math.sin(time * 8) * 8;

        shards.forEach(shardData => {
          const { baseX, baseY, baseZ, offset, speed, targetPosition } = shardData;
          const pullFactor = 0.8;
          const orbitAngle = time * speed * 0.5 + offset;

          targetPosition.x = (baseX * pullFactor) * Math.cos(orbitAngle) - (baseZ * pullFactor) * Math.sin(orbitAngle);
          targetPosition.z = (baseZ * pullFactor) * Math.cos(orbitAngle) + (baseX * pullFactor) * Math.sin(orbitAngle);
          targetPosition.y = (baseY * pullFactor) + Math.sin(time * speed * 2) * 0.3;

          shardData.mesh.rotation.x += shardData.rotSpeedX * 3;
          shardData.mesh.rotation.y += shardData.rotSpeedY * 3;
          if (shardData.mesh.material instanceof THREE.MeshStandardMaterial) {
            shardData.mesh.material.emissiveIntensity = 0.2;
          }
        });
      } else if (currentState === 'responding') {
        const speechIntensity = Math.abs(smoothNoise(time * 5)) * 0.8 + Math.abs(Math.sin(time * 10)) * 0.4;

        core.rotation.y += 0.01;
        innerCore.rotation.y += 0.01;

        const scale = 1 + speechIntensity * 0.3;
        core.scale.set(scale, scale, scale);
        coreLight.intensity = 15 + speechIntensity * 20;

        shards.forEach(shardData => {
          const { baseX, baseY, baseZ, offset, targetPosition } = shardData;
          const pushAmount = 1 + (speechIntensity * (0.5 + Math.sin(offset) * 0.5));
          targetPosition.x = baseX * pushAmount;
          targetPosition.y = baseY * pushAmount;
          targetPosition.z = baseZ * pushAmount;

          shardData.mesh.rotation.x += shardData.rotSpeedX * 2;
          if (shardData.mesh.material instanceof THREE.MeshStandardMaterial) {
            shardData.mesh.material.emissiveIntensity = speechIntensity > 0.6 ? 0.8 : 0.1;
          }
        });
      }

      // Lerp positions
      shards.forEach(shardData => {
        shardData.mesh.position.lerp(shardData.targetPosition, 0.1);
      });

      // Render through Composer (Bloom)
      composer.render();
    };

    // Stop when the panel is closed (it is then zero wide) or scrolled away;
    // start again when it shows. The browser already pauses a hidden tab.
    // Two thresholds: a closed panel still "touches" the screen at zero width,
    // so with the default one the browser reports no change when it opens.
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && entry.intersectionRatio > 0;
      if (visible && !running) {
        lastFrame = 0;
        animateLoop();
      }
    }, { threshold: [0, 0.01] });
    visibilityObserver.observe(container);

    // Run first render and start loop
    handleResize();
    animateLoop();

    // Clean up
    return () => {
      cancelAnimationFrame(animationFrameId);
      visible = false;
      visibilityObserver.disconnect();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      resizeObserver.disconnect();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      innerCoreGeo.dispose();
      innerCoreMat.dispose();
      shardGeo.dispose();
      shardMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
      shards.forEach(s => {
        if (s.mesh.material instanceof THREE.Material) {
          s.mesh.material.dispose();
        }
      });
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative bg-radial-[circle_at_center,_#0a1520_0%,_#000000_70%] border border-[#00e5ff]/20 rounded-sm overflow-hidden select-none outline-none ${className}`}
      style={{ contentVisibility: 'auto' }}
    />
  );
};
