import { useEffect, useRef, useState } from 'react';

/**
 * Shows a 3D model that can be turned, zoomed and moved with the mouse or
 * fingers. Reads GLB/GLTF (which carry their own colours and materials), and
 * STL and OBJ (plain shapes, shown in a neutral grey).
 *
 * The 3D library is large, so it is only loaded when a model is first shown.
 */
export function ModelView({ url, name }: { url: string; name: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup = () => {};
    setState('loading');

    (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      if (disposed) return;

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      host.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 1000);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x4a4a55, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 2);
      sun.position.set(3, 5, 4);
      scene.add(sun);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;

      // Draw only when something changes, so an idle model uses no power.
      let frame = 0;
      const draw = () => {
        frame = 0;
        if (controls.update()) schedule();
        renderer.render(scene, camera);
      };
      const schedule = () => {
        if (!frame) frame = requestAnimationFrame(draw);
      };
      controls.addEventListener('change', schedule);

      const resize = () => {
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (w < 2 || h < 2) return;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        schedule();
      };
      const observer = new ResizeObserver(resize);
      observer.observe(host);

      cleanup = () => {
        observer.disconnect();
        cancelAnimationFrame(frame);
        controls.dispose();
        scene.traverse((obj) => {
          const mesh = obj as import('three').Mesh;
          mesh.geometry?.dispose?.();
          const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
          for (const m of materials) m.dispose?.();
        });
        renderer.dispose();
        renderer.domElement.remove();
      };

      try {
        const ext = name.toLowerCase().split('.').pop();
        const plain = new THREE.MeshStandardMaterial({ color: 0xb9bcc4, roughness: 0.75, metalness: 0.05 });
        let object: import('three').Object3D;
        if (ext === 'stl') {
          const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
          const geometry = await new STLLoader().loadAsync(url);
          geometry.computeVertexNormals();
          object = new THREE.Mesh(geometry, plain);
          object.rotation.x = -Math.PI / 2; // STL files are usually drawn with Z pointing up
        } else if (ext === 'obj') {
          const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
          object = await new OBJLoader().loadAsync(url);
          object.traverse((o) => {
            if ((o as import('three').Mesh).isMesh) (o as import('three').Mesh).material = plain;
          });
        } else {
          const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
          object = (await new GLTFLoader().loadAsync(url)).scene;
        }
        if (disposed) return;

        // Centre the model and pull the camera back far enough to see all of it.
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const centre = box.getCenter(new THREE.Vector3());
        object.position.sub(centre);
        scene.add(object);
        const radius = Math.max(size.length() / 2, 0.001);
        const distance = radius / Math.sin((camera.fov * Math.PI) / 360);
        camera.position.set(distance * 0.7, distance * 0.45, distance * 0.9);
        camera.near = radius / 100;
        camera.far = radius * 100;
        controls.target.set(0, 0, 0);
        resize();
        setState('ready');
      } catch (err) {
        if (disposed) return;
        setMessage(err instanceof Error ? err.message : String(err));
        setState('error');
      }
    })().catch((err: unknown) => {
      if (disposed) return;
      setMessage(err instanceof Error ? err.message : String(err));
      setState('error');
    });

    return () => {
      disposed = true;
      cleanup();
    };
  }, [url, name]);

  return (
    <div className="model" ref={hostRef}>
      {state === 'loading' && <p className="pdf-message">Opening 3D model…</p>}
      {state === 'error' && (
        <p className="pdf-message">
          This model could not be opened. Single-file GLB, STL and OBJ models work best.
          {message ? ` (${message})` : ''}
        </p>
      )}
    </div>
  );
}
