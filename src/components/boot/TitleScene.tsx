/**
 * Heavy boot 3D — loaded only AFTER the title typewriter finishes
 * so PlanetScene / Three never block first paint.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { warmPlanetGeometry } from "@/game/render/PlanetScene";
import { GLOBE_RADIUS } from "@/game/sim/defs";

function BootStars() {
  const ref = useRef<THREE.Points>(null);
  const { geo, mat } = useMemo(() => {
    const COUNT = 2200;
    const positions = new Float32Array(COUNT * 3);
    const colors = new Float32Array(COUNT * 3);
    const c = new THREE.Color();
    for (let i = 0; i < COUNT; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = 520 + Math.random() * 680;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
      const roll = Math.random();
      if (roll < 0.12) c.set("#88ffcc");
      else if (roll < 0.28) c.set("#aaccff");
      else c.set("#e8fff4");
      c.multiplyScalar(0.4 + Math.random() * 0.6);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const m = new THREE.PointsMaterial({
      size: 0.9,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      toneMapped: false,
    });
    return { geo: g, mat: m };
  }, []);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.008;
  });
  return <points ref={ref} geometry={geo} material={mat} />;
}

function BootPlanet({ zoom }: { zoom: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const [geo, setGeo] = useState<THREE.BufferGeometry | null>(null);

  const solidMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        flatShading: true,
        roughness: 0.85,
        metalness: 0.05,
      }),
    [],
  );
  const wireMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#00ffaa",
        wireframe: true,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const stubWireMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#00ffaa",
        wireframe: true,
        transparent: true,
        opacity: 0.35,
        toneMapped: false,
      }),
    [],
  );
  const stubFillMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#061410",
        transparent: true,
        opacity: 0.55,
        toneMapped: false,
      }),
    [],
  );
  const glowMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: "#00ffaa",
        transparent: true,
        opacity: 0.04,
        side: THREE.BackSide,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  );
  const stubGeo = useMemo(() => new THREE.IcosahedronGeometry(GLOBE_RADIUS, 5), []);
  const stubFillGeo = useMemo(() => new THREE.IcosahedronGeometry(GLOBE_RADIUS * 0.992, 4), []);

  useEffect(() => {
    let alive = true;
    void warmPlanetGeometry()
      .then((g) => {
        if (alive) setGeo(g);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useFrame((_, dt) => {
    if (groupRef.current) groupRef.current.rotation.y += dt * 0.06;
  });

  const s = THREE.MathUtils.lerp(0.04, 1, zoom);

  return (
    <group ref={groupRef} scale={s}>
      {geo ? (
        <>
          <mesh geometry={geo} material={solidMat} />
          <mesh geometry={geo} material={wireMat} scale={1.002} />
          <mesh scale={1.035}>
            <sphereGeometry args={[GLOBE_RADIUS, 32, 24]} />
            <meshBasicMaterial
              color="#00ffaa"
              transparent
              opacity={0.04}
              side={THREE.BackSide}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
        </>
      ) : (
        <>
          <mesh geometry={stubFillGeo} material={stubFillMat} />
          <mesh geometry={stubGeo} material={stubWireMat} />
          <mesh scale={1.04} geometry={stubGeo} material={glowMat} />
        </>
      )}
    </group>
  );
}

function BootCamera() {
  const { camera } = useThree();
  useEffect(() => {
    const dist = GLOBE_RADIUS + 220;
    camera.position.set(dist * 0.12, dist * 0.16, dist);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, GLOBE_RADIUS * 0.04, 0);
    camera.far = 2500;
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

function BootSceneInner({ zoom }: { zoom: number }) {
  return (
    <>
      <color attach="background" args={["#020806"]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[40, 70, 30]} intensity={1.2} color="#e8fff4" />
      <BootStars />
      <BootPlanet zoom={zoom} />
      <BootCamera />
    </>
  );
}

export function TitleScene({ zoom }: { zoom: number }) {
  return (
    <Canvas
      className="absolute inset-0"
      dpr={[1, 1.5]}
      camera={{
        position: [GLOBE_RADIUS * 0.12 + 26, (GLOBE_RADIUS + 220) * 0.16, GLOBE_RADIUS + 220],
        fov: 42,
        near: 0.5,
        far: 2500,
      }}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: "default",
        toneMapping: THREE.NoToneMapping,
      }}
    >
      <BootSceneInner zoom={zoom} />
    </Canvas>
  );
}
